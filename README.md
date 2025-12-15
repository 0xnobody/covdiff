# CovDiff Visualization

Interactive fuzzer coverage diff visualization dashboard.

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

## Deployment

The dashboard automatically deploys to GitHub Pages when pushed to the main branch. 
