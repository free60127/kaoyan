# PDF Chinese font

`YantuPdfSC-Regular.ttf` is a static weight 400 build of Noto Sans SC. The
derived family is named **Yantu PDF SC**. The original font is distributed under
the SIL Open Font License 1.1; the complete license is in `OFL.txt` alongside it.
The application downloads this font only when PDF export is requested and
embeds a subset of the glyphs actually used in the document.

## Provenance

- Source: Google Fonts, `ofl/notosanssc/NotoSansSC[wght].ttf`
- Download URL: https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
- Source SHA-256: `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`
- Derived font SHA-256: `2ad72393bd83f1768d9383f8cb69659cbb240370a7b1de7c9bc6c8a78267cae6`
- License source: https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt
- Build: `fontTools.varLib.instancer`, axis `wght=400`; family, full, unique and
  PostScript names are changed to Yantu PDF SC. Other font data is retained.
- Built with FontTools 4.66.1 on 2026-09-30.

To reproduce, install `fonttools` and run:

```text
python scripts/build-backup-font.py path/to/NotoSansSC-variable.ttf
```

The script verifies the pinned source checksum before building. FontTools
version differences can change binary table serialization; retain the source
and derived checksums when updating this asset.
