<p align="center">
<img src="logo.png" alt="Alt Text" width="200">
</p>

# covdiff
Interactive fuzzer coverage diff visualization dashboard.

For more information, read [the paper](covdiff.pdf).

🔗 **Live Demo:** https://0xnobody.github.io/covdiff/

## Features

- Interactive treemaps for modules, functions, and basic blocks
- Call graph visualization with expandable nodes
- Coverage diff analysis between fuzzing campaigns
- Filter controls for focused analysis

## Local Development

```bash
cd covdiff-viz
npm install
npm run dev
```

Visit http://localhost:5173

## Electron App

```bash
npm run electron:dev
```

## Build

```bash
# Web build
npm run build

# GitHub Pages build
npm run build:gh-pages

# Electron build
npm run electron:build
```

## Licence

See [LICENCE.md](LICENCE.md)