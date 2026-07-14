import json
import os
import argparse

def generate_shorts(json_path, output_dir):
    if not os.path.exists(json_path):
        print(f"File not found: {json_path}")
        return

    os.makedirs(output_dir, exist_ok=True)
    count = 0

    with open(json_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON in {json_path}: {e}")
            return

    for slug, url in data.items():
        slug = slug.strip()
        url = url.strip()
        
        if not slug or not url:
            continue
            
        slug_dir = os.path.join(output_dir, slug)
        os.makedirs(slug_dir, exist_ok=True)
        
        html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0; url={url}">
    <title>Redirigiendo...</title>
</head>
<body>
    <p>Redirigiendo a <a href="{url}">{url}</a>...</p>
</body>
</html>"""
        
        index_path = os.path.join(slug_dir, 'index.html')
        with open(index_path, 'w', encoding='utf-8') as out_f:
            out_f.write(html_content)
        
        count += 1
        print(f"Generated: {output_dir}/{slug}/index.html -> {url}")
            
    print(f"Total shorts generated: {count}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Generate static HTML redirects for short URLs.")
    parser.add_argument('--json', default='sh/shorturls.json', help='Path to the shorts JSON file.')
    parser.add_argument('--out', default='sh', help='Output directory for generated folders.')
    args = parser.parse_args()
    
    generate_shorts(args.json, args.out)
