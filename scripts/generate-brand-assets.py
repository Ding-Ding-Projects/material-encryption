"""Generate deterministic application-brand raster assets from the committed master PNG."""

from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "design" / "material-encryption-logo-master.png"
DESIGN_PNG = ROOT / "design" / "assets" / "material-encryption-logo.png"
RENDERER_PNG = ROOT / "src" / "renderer" / "assets" / "material-encryption-logo.png"
ICON = ROOT / "build" / "material-encryption.ico"
ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def main() -> None:
    if not MASTER.is_file():
        raise SystemExit(f"Missing committed logo master: {MASTER}")

    with Image.open(MASTER) as source:
        source.load()
        if source.format != "PNG" or source.width != source.height or source.width < 1024:
            raise SystemExit("Logo master must be a square PNG at least 1024 pixels wide.")
        image = source.convert("RGBA")

    for target in (DESIGN_PNG, RENDERER_PNG, ICON):
        target.parent.mkdir(parents=True, exist_ok=True)

    image.resize((512, 512), Image.Resampling.LANCZOS).save(DESIGN_PNG, "PNG", optimize=True)
    image.resize((256, 256), Image.Resampling.LANCZOS).save(RENDERER_PNG, "PNG", optimize=True)
    image.save(ICON, "ICO", sizes=[(size, size) for size in ICON_SIZES])

    with Image.open(ICON) as generated:
        if generated.format != "ICO" or generated.size != (256, 256):
            raise SystemExit("Generated Windows icon is not a valid multi-size ICO.")
        available_sizes = set(generated.ico.sizes())
        missing = {(size, size) for size in ICON_SIZES} - available_sizes
        if missing:
            raise SystemExit(f"Generated Windows icon is missing sizes: {sorted(missing)}")

    print(f"Generated brand PNGs and {ICON.name} with {len(available_sizes)} verified sizes.")


if __name__ == "__main__":
    main()
