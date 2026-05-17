# LizardByte Package Repository

This repository serves as a centralized package index and filtered release asset mirror for repositories within the
LizardByte organization. Configured release assets are automatically downloaded and organized in the `dist` branch for
easy access and distribution.

## Structure

The repository is organized as follows:

```
dist/
├── repo-name-1/
│   ├── v1.0.0/
│   │   ├── asset1.zip
│   │   ├── asset1.zip.sha256
│   │   ├── asset1.zip.sha512
│   │   ├── asset1.zip.md5
│   │   └── ...
│   └── v1.1.0/
│       └── ...
├── repo-name-2/
│   └── ...
└── ...
```

## Features

- **Automated Collection**: GitHub Actions workflow automatically downloads release assets from all org repos
- **Hash Validation**: Each asset includes SHA256, SHA512, and MD5 hash files for integrity verification
- **Organized Structure**: Assets are organized by repository name and release tag
- **Incremental Updates**: Only new assets are downloaded to avoid duplication
- **Scheduled Updates**: Runs every hour to keep assets up-to-date

## Workflow

The release asset collection and GitHub Pages deployment are handled by the `update-pages.yml` workflow. Asset
retention is controlled by `packages.config.json`.

1. Discovers all repositories in the LizardByte organization
2. Fetches release information for each repository
3. Downloads configured release assets
4. Removes previously stored assets that are no longer configured
5. Generates hash files for integrity verification
6. Commits changes to the `dist` branch
7. Rebuilds GitHub Pages and publishes the filtered `dist` assets there too

## Configuration

`packages.config.json` controls which release assets are retained in `dist` and published to GitHub Pages.
`packages.json` is still generated from GitHub release metadata for all discovered assets. `defaultInclude` is
`false`, so repositories must opt in with asset patterns for files that should be mirrored.

```json
{
  "defaultInclude": false,
  "repositories": {
    "Sunshine": {
      "includeAssets": [
        "*-installer.exe",
        "*-installer.msi"
      ]
    }
  }
}
```

## Usage

Configured release assets are available in the `dist` branch of this repository. You can:

- Browse assets directly on GitHub
- Clone the `dist` branch for offline access
- Use GitHub Pages direct URLs that mirror the `dist` layout, e.g. `/packages/<repo>/<tag>/<asset>`
- Use the hash files to verify asset integrity
