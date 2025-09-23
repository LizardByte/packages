# LizardByte Package Repository

This repository serves as a centralized storage for all packages and release assets from repositories within the
LizardByte organization. All release assets are automatically downloaded and organized in the `dist` branch for
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

The release asset collection is handled by the `sync-release-assets.yml` workflow which:

1. Discovers all repositories in the LizardByte organization
2. Fetches release information for each repository
3. Downloads missing release assets
4. Generates hash files for integrity verification
5. Commits changes to the `dist` branch

## Usage

All release assets are available in the `dist` branch of this repository. You can:

- Browse assets directly on GitHub
- Clone the `dist` branch for offline access
- Use the hash files to verify asset integrity
