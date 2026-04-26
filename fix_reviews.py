import os
import glob
import time
import difflib
import re
from google import genai
from google.genai import types

# Configurar cliente GenAI
client = genai.Client(api_key="AIzaSyBfKnYGDVRcVPbqw9SowfWL7M2J0YCNxEE")

sys_instr = "Eres un corrector experto en español. Corrige la ortografía, tildes, gramática y comas del usuario. Preserva el tono y estilo original. Mantén intactos los tags HTML internos como <br />. IMPORTANTE: Entrega ÚNICAMENTE el texto final corregido, sin notas, ni saludos, ni comillas extra de markdown."

files = glob.glob("reviews/*.html")
os.makedirs("reviews/corrections", exist_ok=True)

processed = 0
for f in files:
    basename = os.path.basename(f)
    diff_file = f"reviews/corrections/{basename.replace('.html', '.diff')}"
    
    if os.path.exists(diff_file):
        continue  # Ya procesado
        
    try:
        with open(f, "r", encoding="utf-8") as file:
            original_content = file.read()
            
        # Extraer usando regex para preservar el original text del articulo
        article_match = re.search(r'(<article\s+class="card"[^>]*>)(.*?)(</article>)', original_content, re.IGNORECASE | re.DOTALL)
        if not article_match:
            continue
            
        prefix = article_match.group(1)
        inner_raw = article_match.group(2)
        suffix = article_match.group(3)
        inner_html = inner_raw.strip()
        
        if not inner_html or len(inner_html.split()) < 3:
            continue
            
        print(f"Procesando {basename}...")
        
        # Llamada a Gemini usando el nuevo SDK, asegurando el uso del mejor modelo gratis disponible
        response = client.models.generate_content(
            model="gemini-flash-lite-latest",
            contents=inner_html,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
            )
        )
        corrected_html = response.text.strip()
        
        # Ocasionalmente el modelo envuelve en ```html
        if corrected_html.startswith("```html"):
            corrected_html = corrected_html[7:]
        if corrected_html.startswith("```"):
            corrected_html = corrected_html[3:]
        if corrected_html.endswith("```"):
            corrected_html = corrected_html[:-3]
        corrected_html = corrected_html.strip()
        
        if not corrected_html or corrected_html == inner_html:
            # Sin cambios textuales significativos
            with open(diff_file, "w", encoding="utf-8") as dfile:
                dfile.write("")
            continue
            
        # Reemplazar con regex reconstructiva
        # Reconstruimos usando los espacios crudos que removimos al extraer (inner_raw vs inner_html)
        space_before = inner_raw[:len(inner_raw) - len(inner_raw.lstrip())]
        space_after = inner_raw[len(inner_raw.rstrip()):]
        reconstructed_article = prefix + space_before + corrected_html + space_after + suffix
        
        new_content = original_content[:article_match.start()] + reconstructed_article + original_content[article_match.end():]
        
        if new_content == original_content:
            with open(diff_file, "w", encoding="utf-8") as dfile:
                dfile.write("")
            continue
            
        # Crear diff
        old_lines = original_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff = list(difflib.unified_diff(
            old_lines, new_lines, fromfile=f"{basename}.orig", tofile=basename
        ))
        
        if diff:
            with open(diff_file, "w", encoding="utf-8") as dfile:
                dfile.writelines(diff)
            with open(f, "w", encoding="utf-8") as hfile:
                hfile.write(new_content)
                
        processed += 1
        print(f"-> {basename} actualizado.")
        time.sleep(5.5)  # Evitar RateLimit del Free Tier de 15 requests / minuto
        
    except genai.errors.APIError as api_err:
        print(f"Error AI en {basename}: {api_err}. Pausando 30s...")
        time.sleep(30)
        continue
    except Exception as e:
        print(f"Error procesando {basename}: {e}")
        time.sleep(5.5)

print(f"Completado. {processed} archivos procesados y actualizados en esta tanda.")
