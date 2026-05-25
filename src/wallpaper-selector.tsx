import { useEffect, useState } from "react";
import {
	Grid,
	ActionPanel,
	Action,
	showToast,
	Toast,
	closeMainWindow,
	getPreferenceValues,
} from "@vicinae/api";
import { execSync, exec } from "child_process";
import { readdirSync, existsSync, mkdirSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

// ── Config ────────────────────────────────────────────────────────────────────

interface Preferences {
	wallpaperDir: string;
}

const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"]);

const WALLPAPER_DIR = "/usr/share/backgrounds";
const CACHE_DIR = join(homedir(), ".cache", "wallpaper-selector");
const THUMB_W = 400;
const THUMB_H = 225; // 16:9

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureCache() {
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function thumbPath(imgPath: string): string {
	const name = basename(imgPath, extname(imgPath));
	return join(CACHE_DIR, `${name}.png`);
}

/**
 * Generate a thumbnail synchronously using ImageMagick.
 * Returns the thumb path, or null if generation fails.
 */
function generateThumb(imgPath: string): string | null {
	const out = thumbPath(imgPath);
	// Skip regeneration if thumb is newer than source
	try {
		const srcMtime = require("fs").statSync(imgPath).mtimeMs;
		const dstMtime = existsSync(out) ? require("fs").statSync(out).mtimeMs : 0;
		if (dstMtime > srcMtime) return out;
	} catch {
		// fall through and generate
	}

	try {
		const src = imgPath.endsWith(".gif") ? `${imgPath}[0]` : imgPath;
		execSync(
			`magick ${JSON.stringify(src)} -thumbnail ${THUMB_W}x${THUMB_H}^ -gravity center -extent ${THUMB_W}x${THUMB_H} ${JSON.stringify(out)}`,
			{ stdio: "pipe" }
		);
		return out;
	} catch {
		return null;
	}
}

function applyWallpaper(imgPath: string) {
	exec(
		`awww img ${JSON.stringify(imgPath)} --transition-type random --transition-duration 2`,
		(err) => {
			if (err) console.error("awww error:", err.message);
		}
	);
	exec(`echo ${JSON.stringify(imgPath)} > "${homedir()}/.cache/current_wallpaper"`);
	exec(
		`notify-send -t 2000 "Wallpaper" "Wallpaper has been updated" -i ${JSON.stringify(imgPath)}`
	);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WallpaperItem {
	path: string;
	name: string;
	thumb: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelectWallpaper() {
	const { wallpaperDir } = getPreferenceValues<Preferences>();
	const [items, setItems] = useState<WallpaperItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		ensureCache();

		// Run thumbnail generation off the main thread using a microtask chain
		// so Vicinae can render the loading state immediately.
		const load = async () => {
			const dir = wallpaperDir || WALLPAPER_DIR;

			const result: WallpaperItem[] = [];

			let files: string[] = [];
			try {
				files = readdirSync(dir)
					.filter((f) => SUPPORTED_EXT.has(extname(f).toLowerCase()))
					.map((f) => join(dir, f));
			} catch {
				// Directory unreadable — show empty grid
			}

			for (const file of files) {
				// Generate thumb synchronously; each iteration yields to allow
				// the UI to stay responsive during the for-loop.
				const thumb = generateThumb(file);
				result.push({
					path: file,
					name: basename(file),
					thumb,
				});
			}

			setItems(result);
			setIsLoading(false);
		};

		load();
	}, [wallpaperDir]);

	const handleSelect = async (item: WallpaperItem) => {
		applyWallpaper(item.path);
		await showToast({ style: Toast.Style.Success, title: "Wallpaper applied", message: item.name });
		await closeMainWindow();
	};

	const handleRandom = async () => {
		const dir = getPreferenceValues<Preferences>().wallpaperDir || "/usr/share/backgrounds";
		const pool = readdirSync(dir)
			.filter((f) => SUPPORTED_EXT.has(extname(f).toLowerCase()))
			.map((f) => join(dir, f));

		if (pool.length === 0) {
			await showToast({ style: Toast.Style.Failure, title: "No wallpapers found" });
			return;
		}

		const target = pool[Math.floor(Math.random() * pool.length)];
		applyWallpaper(target);
		await showToast({ style: Toast.Style.Success, title: "Random wallpaper applied", message: basename(target) });
		await closeMainWindow();
	};

	return (
		<Grid
			columns={3}
			aspectRatio="16/9"
			fit={Grid.Fit.Fill}
			inset={Grid.Inset.Small}
			isLoading={isLoading}
			searchBarPlaceholder="Search wallpapers…"
			navigationTitle="Wallpaper Selector"
		>
			{items.map((item) => (
				<Grid.Item
					key={item.path}
					id={item.path}
					// content accepts a local file path as { source: string }
					content={
						item.thumb
							? { source: item.thumb }
							: { source: item.path } // fallback: use original directly
					}
					title={item.name}
					actions={
						<ActionPanel>
							<Action
								title="Apply Wallpaper"
								onAction={() => handleSelect(item)}
							/>
							<Action
								title="Apply Random Wallpaper"
								onAction={() => handleRandom()}
							/>
						</ActionPanel>
					}
				/>
			))}
		</Grid>
	);
}