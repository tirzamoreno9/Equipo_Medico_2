# Sistema de Consulta de Equipamiento Médico por Establecimiento de Salud

Plataforma de uso interno para consultar equipamiento médico, capacidad hospitalaria (camas),
especialidades y recursos humanos por establecimiento de salud en México.

Sitio estático (HTML/CSS/JS sin frameworks ni backend): los "endpoints" son archivos JSON en
[`data/`](data/), generados a partir de los catálogos oficiales CLUES y SINERHIAS mediante el
script `etl.py` (fuera de este repositorio, junto a las bases fuente en Excel).

## Correr localmente

```bash
python3 -m http.server 8811
```

Luego abre `http://localhost:8811`.

## Publicar en GitHub Pages

1. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Rama: `main`, carpeta: `/ (root)`.
3. Guardar. El sitio queda publicado en `https://<usuario>.github.io/<repositorio>/`.

## Alcance de los datos

- Universo: 24,208 establecimientos de salud públicos y en operación.
- Fuente: catálogo CLUES y SINERHIAS (Dirección General de Información en Salud).
- No incluye datos personales de pacientes ni de personal.
- Ver la sección "Cobertura y fuentes" dentro de la plataforma para el detalle completo.
