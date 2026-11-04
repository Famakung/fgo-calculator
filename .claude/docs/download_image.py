import sys
import os
import urllib.request
from PIL import Image


def download_and_convert(internal_id, collection_id):
    # Construct the URL: strip trailing "00" from long ID to get base, then append ascension code
    # E.g. internal_id=1102000 -> base=11020 -> URL f_11020000.png (1st ascension)
    base = str(internal_id)
    if base.endswith("00"):
        base = base[:-2]
    url = f"https://static.atlasacademy.io/JP/Faces/f_{base}000.png"

    # Construct the output directory and path based on the script's location (assumed to be in .claude/docs)
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    output_dir = os.path.join(root_dir, "public", "servants", collection_id)
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "000.webp")
    png_path = os.path.join(output_dir, "000.png")

    print(f"Downloading from: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            with open(png_path, "wb") as f:
                f.write(response.read())

            print("Download successful. Converting to WEBP...")
            img = Image.open(png_path)
            img.save(output_path, "WEBP", quality=80)
            img.close()

            os.remove(png_path)
            print(
                f"Successfully saved to: {output_path} (80% quality) and removed temporary PNG."
            )
    except Exception as e:
        print(f"Error downloading or converting image: {e}")


if __name__ == "__main__":
    # Support both command-line arguments and interactive input
    if len(sys.argv) >= 3:
        internal_id = sys.argv[1]
        collection_id = sys.argv[2]
    else:
        internal_id = input("Enter internal ID (e.g., 4056): ").strip()
        collection_id = input("Enter collection ID (e.g., 468): ").strip()

    if internal_id and collection_id:
        download_and_convert(internal_id, collection_id)
    else:
        print("Both IDs are required.")
