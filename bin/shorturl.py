#!/usr/bin/env python3
import sys
import os
import argparse
import csv

def main():
    parser = argparse.ArgumentParser(description="Create a short URL redirect.")
    parser.add_argument('short_url', help="The short URL e.g., jorgezuluaga.github.io/sh/montupython-desktop-windows")
    parser.add_argument('destination_url', help="The destination URL")
    
    args = parser.parse_args()
    
    raw_short_url = args.short_url
    
    # Strip protocol
    if raw_short_url.startswith('http://'):
        raw_short_url = raw_short_url[7:]
    elif raw_short_url.startswith('https://'):
        raw_short_url = raw_short_url[8:]
        
    # Strip known domain
    if raw_short_url.startswith('jorgezuluaga.github.io/'):
        raw_short_url = raw_short_url[len('jorgezuluaga.github.io/'):]
        
    # If it's just a slug without slashes, assume it goes in sh/
    if not raw_short_url.startswith('sh/') and '/' not in raw_short_url:
        path = 'sh/' + raw_short_url
    else:
        path = raw_short_url
        
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_dir = os.path.join(repo_root, path)
    
    os.makedirs(target_dir, exist_ok=True)
    
    index_path = os.path.join(target_dir, 'index.html')
    
    html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0; url={args.destination_url}">
    <title>Redirigiendo...</title>
</head>
<body>
    <p>Redirigiendo a <a href="{args.destination_url}">{args.destination_url}</a>...</p>
</body>
</html>"""

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    print(f"Created short URL redirect at {path}/index.html")
    print(f"Target: {args.destination_url}")
    
    # Also update sh/shorturls.json if this is an "sh/" link to keep things synchronized
    if path.startswith('sh/'):
        slug = path[3:]
        json_path = os.path.join(repo_root, 'sh', 'shorturls.json')
        
        import json
        data = {}
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                try:
                    data = json.load(f)
                except json.JSONDecodeError:
                    pass
        
        data[slug] = args.destination_url
        
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            
        print(f"Updated sh/shorturls.json with slug '{slug}'")

if __name__ == '__main__':
    main()
