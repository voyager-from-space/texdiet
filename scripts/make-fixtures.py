#!/usr/bin/env python3
"""Build the test zips.

small: test/fixtures/small-thesis.zip, committed (~2 MB), used by verify.mjs and as the in-app sample.
heavy: test/heavy/heavy-thesis.zip, not committed, a thesis layout whose figures
are public-domain NASA/JPL images (images-assets.nasa.gov) saved the way students
often export them: full-resolution PNGs and camera-size JPGs.
"""
import io, os, sys, zipfile, urllib.request, random
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NASA = ["PIA23645", "PIA25433", "PIA21421", "PIA22946", "PIA23122", "PIA19048", "PIA24546", "PIA17171"]

PREAMBLE = r"""\documentclass[12pt,a4paper]{report}
\usepackage{fontspec}
\setmainfont{TeX Gyre Termes}
\setsansfont{TeX Gyre Heros}
\setmonofont{TeX Gyre Cursor}
\newfontfamily\captionfont{TeX Gyre Pagella}
\usepackage{graphicx}
\usepackage{float}
\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage{minted}
\usepackage{tabularray}
\usepackage[version=4]{mhchem}
\usepackage{epstopdf}
\usepackage[backend=biber,style=numeric]{biblatex}
\addbibresource{refs.bib}
% \tikzexternalize  % tried once, broke the build
\begin{document}
\tableofcontents
\include{chapters/intro}
\include{chapters/data}
\include{chapters/results}
\printbibliography
\end{document}
"""

INTRO = r"""\chapter{Introduction}
Planetary imaging has grown by orders of magnitude \cite{ref1,ref2}.
\begin{figure}[H]
  \centering
  \includegraphics[width=0.8\textwidth]{figures/jupiter_full.png}
  \caption{Full-disk mosaic.}
\end{figure}
\begin{figure}[H]
  \centering
  \includegraphics[width=0.6\textwidth]{figures/surface_scan.png}
  \caption{Surface scan.}
\end{figure}
\begin{figure}[H]
  \centering
  \includegraphics[width=\textwidth]{figures/orbit_diagram.eps}
  \caption{Orbit geometry.}
\end{figure}
\ce{H2O} and \ce{CO2} ices dominate the polar caps.
"""

def tikz_block(i):
    return (r"\begin{tikzpicture}" "\n"
            + "".join(rf"  \draw[thin] ({x/4:.2f},0) -- ({x/4:.2f},{(x*i)%7/2:.2f});" "\n" for x in range(40))
            + r"\end{tikzpicture}" "\n")

def data_chapter():
    coords = " ".join(f"({x},{(x*37)%101})" for x in range(1500))
    s = r"\chapter{Data}" "\n"
    for i in range(6):
        s += r"\begin{figure}[H]\centering" "\n" + tikz_block(i) + rf"\caption{{Sampling pass {i}.}}\end{{figure}}" "\n"
    s += (r"\begin{figure}[H]\centering" "\n" r"\begin{tikzpicture}\begin{axis}[width=12cm]" "\n"
          rf"\addplot coordinates {{{coords}}};" "\n"
          r"\addplot table {data/telemetry.dat};" "\n"
          r"\end{axis}\end{tikzpicture}\caption{Telemetry.}\end{figure}" "\n")
    s += r"\begin{minted}{python}" "\nimport numpy as np\nprint(np.mean([1,2,3]))\n" r"\end{minted}" "\n"
    s += r"\begin{tblr}{colspec={lll}} a & b & c \\ \end{tblr}" "\n"
    return s

RESULTS = r"""\chapter{Results}
\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/ring_closeup.png}\caption{Rings.}\end{figure}
\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/crater_field.jpg}\caption{Craters.}\end{figure}
\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/dust_storm.jpg}\caption{Dust storm.}\end{figure}
\begin{figure}[H]\centering\includegraphics[width=\textwidth]{figures/spectra_plot.pdf}\caption{Spectra.}\end{figure}
\begin{figure}[H]\centering\includegraphics[width=0.5\textwidth]{figures/missing_figure}\caption{TODO.}\end{figure}
"""

def bib(n):
    return "".join(f"@article{{ref{i},\n  author={{Doe, J. and Roe, R.}},\n  title={{Observation campaign {i}}},\n  journal={{Icarus}},\n  year={{{1990 + i % 35}}},\n  volume={{{i}}},\n  pages={{1--20}}\n}}\n\n" for i in range(1, n + 1))

def uncompressed_pdf(n_paths):
    """A vector figure written with no stream compression, like some plotting exports."""
    ops = "".join(f"{random.uniform(0,500):.3f} {random.uniform(0,300):.3f} m {random.uniform(0,500):.3f} {random.uniform(0,300):.3f} l S\n" for _ in range(n_paths)).encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 300] /Contents 4 0 R >>",
            b"<< /Length %d >>\nstream\n" % len(ops) + ops + b"endstream"]
    out = bytearray(b"%PDF-1.4\n"); offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return bytes(out)

def eps(n):
    body = "".join(f"{random.uniform(0,400):.2f} {random.uniform(0,300):.2f} moveto {random.uniform(0,400):.2f} {random.uniform(0,300):.2f} lineto stroke\n" for _ in range(n))
    return ("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 400 300\n" + body + "showpage\n").encode()

def png_bytes(im):
    b = io.BytesIO(); im.save(b, "PNG", compress_level=1); return b.getvalue()

def fetch(pid):
    cache = os.path.join(ROOT, "test/heavy/src", pid + ".jpg")
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        urllib.request.urlretrieve(f"https://images-assets.nasa.gov/image/{pid}/{pid}~orig.jpg", cache)
    return cache

def write(path, files):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr("thesis/" + name, data)
    print(path, os.path.getsize(path), "bytes,", len(files), "files")

def common(nbib):
    return {"main.tex": PREAMBLE, "chapters/intro.tex": INTRO, "chapters/data.tex": data_chapter(),
            "chapters/results.tex": RESULTS, "refs.bib": bib(nbib),
            "data/telemetry.dat": "x y\n" + "".join(f"{i} {(i*13)%97}\n" for i in range(20000))}

def small():
    """A light but real-looking project: same tex, NASA photos at moderate sizes, so it doubles as the in-app sample."""
    random.seed(1)
    f = common(40)
    f["figures/jupiter_full.png"] = png_bytes(Image.open(fetch("PIA24546")).convert("RGB"))
    f["figures/ring_closeup.png"] = png_bytes(Image.open(fetch("PIA19048")).convert("RGB").resize((1150, 850)))
    f["figures/surface_scan.png"] = png_bytes(Image.open(fetch("PIA17171")).convert("RGB").resize((419, 479)))
    f["figures/crater_field.jpg"] = open(fetch("PIA23122"), "rb").read()
    f["figures/dust_storm.jpg"] = open(fetch("PIA24546"), "rb").read()
    f["figures/orbit_diagram.eps"] = eps(200)
    f["figures/spectra_plot.pdf"] = uncompressed_pdf(8000)
    f["figures/unused_draft.png"] = png_bytes(Image.new("RGB", (800, 600), (0, 0, 0)))
    f["SOURCES.txt"] = "Figures are public-domain NASA/JPL images from images-assets.nasa.gov: PIA24546, PIA19048, PIA17171, PIA23122. Vector figures and text are generated test data.\n"
    write(os.path.join(ROOT, "test/fixtures/small-thesis.zip"), f)

def heavy():
    random.seed(2)
    f = common(1200)
    img = {pid: Image.open(fetch(pid)).convert("RGB") for pid in NASA}
    f["figures/jupiter_full.png"] = png_bytes(img["PIA23645"])
    f["figures/ring_closeup.png"] = png_bytes(img["PIA25433"])
    f["figures/surface_scan.png"] = png_bytes(img["PIA21421"])
    f["figures/unused_draft.png"] = png_bytes(img["PIA22946"])
    f["figures/crater_field.jpg"] = open(fetch("PIA23122"), "rb").read()
    f["figures/dust_storm.jpg"] = open(fetch("PIA19048"), "rb").read()
    f["figures/logo.jpg"] = open(fetch("PIA17171"), "rb").read()
    f["figures/orbit_diagram.eps"] = eps(60000)
    f["figures/spectra_plot.pdf"] = uncompressed_pdf(120000)
    f["SOURCES.txt"] = ("Figures are public-domain NASA/JPL images from images-assets.nasa.gov: "
                        + ", ".join(NASA) + ". Vector figures and text are generated test data.\n")
    write(os.path.join(ROOT, "test/heavy/heavy-thesis.zip"), f)

PROOF_MAIN = r"""\documentclass[12pt,a4paper]{report}
\usepackage{graphicx}
\usepackage{float}
\usepackage{tikz}
\begin{document}
\include{chapters/intro}
\include{chapters/data}
\include{chapters/results}
\end{document}
"""

def proof():
    """pdfLaTeX-only variant of the heavy thesis (no fontspec/minted/biber/pgfplots), for timing compiles in a WASM pdfTeX."""
    random.seed(3)
    coords = " -- ".join(f"({x/150:.3f},{((x*37)%101)/25:.3f})" for x in range(1500))
    data = r"\chapter{Data}" "\n"
    for i in range(6):
        data += r"\begin{figure}[H]\centering" "\n" + tikz_block(i) + rf"\caption{{Sampling pass {i}.}}\end{{figure}}" "\n"
    data += r"\begin{figure}[H]\centering\begin{tikzpicture}\draw[thin] " + coords + r";\end{tikzpicture}\caption{Telemetry.}\end{figure}" "\n"
    intro = INTRO.replace(r"""\begin{figure}[H]
  \centering
  \includegraphics[width=\textwidth]{figures/orbit_diagram.eps}
  \caption{Orbit geometry.}
\end{figure}
""", "").replace(r"\ce{H2O} and \ce{CO2}", "Water and carbon dioxide").replace(r" \cite{ref1,ref2}", "")
    results = RESULTS.replace(r"\begin{figure}[H]\centering\includegraphics[width=0.5\textwidth]{figures/missing_figure}\caption{TODO.}\end{figure}" "\n", "")
    img = {pid: Image.open(fetch(pid)).convert("RGB") for pid in ["PIA23645", "PIA25433", "PIA21421"]}
    f = {"main.tex": PROOF_MAIN, "chapters/intro.tex": intro, "chapters/data.tex": data, "chapters/results.tex": results,
         "figures/jupiter_full.png": png_bytes(img["PIA23645"]), "figures/ring_closeup.png": png_bytes(img["PIA25433"]),
         "figures/surface_scan.png": png_bytes(img["PIA21421"]),
         "figures/crater_field.jpg": open(fetch("PIA23122"), "rb").read(), "figures/dust_storm.jpg": open(fetch("PIA19048"), "rb").read(),
         "figures/spectra_plot.pdf": uncompressed_pdf(120000),
         "SOURCES.txt": "Figures are public-domain NASA/JPL images from images-assets.nasa.gov: PIA23645, PIA25433, PIA21421, PIA23122, PIA19048. Vector figures and text are generated test data.\n"}
    write(os.path.join(ROOT, "test/heavy/proof-thesis.zip"), f)

if __name__ == "__main__":
    which = sys.argv[1:] or ["small", "heavy"]
    for w in which: {"small": small, "heavy": heavy, "proof": proof}[w]()
