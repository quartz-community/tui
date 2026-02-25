# @quartz-community/tui

An interactive terminal UI for managing Quartz plugins, configuration, and layout. Built with [OpenTUI](https://github.com/nicobrinkkemper/opentui) and requires the [Bun](https://bun.sh) runtime.

## Installation

```bash
npx quartz plugin add github:quartz-community/tui
```

## Usage

Launch the TUI from your Quartz project root:

```bash
npx quartz tui
```

Or equivalently:

```bash
npx quartz plugin
```

The TUI provides three panels:

### Plugins Panel

- Browse installed plugins with status indicators (enabled/disabled)
- Add plugins from Git repositories
- Remove installed plugins
- Update plugins to latest versions
- Enable/disable plugins in your configuration

### Settings Panel

- Edit `quartz.config.yaml` settings interactively
- Modify site title, description, base URL, and other options
- Reset settings to defaults

### Layout Panel

- View and reorder layout components (head, header, beforeBody, left, right, afterBody, footer)
- Drag-and-drop style reordering of plugin positions within each layout zone

## Requirements

- **Bun runtime**: The TUI requires [Bun](https://bun.sh/docs/installation) to run (OpenTUI uses `bun:ffi` for its Zig-based terminal renderer)
- **Quartz v5**: Must be run from within a Quartz v5 project directory

## Architecture

The TUI operates as a standalone plugin that interacts with your Quartz project through two mechanisms:

- **CLI bridge**: Git-based plugin operations (add, remove, update, install, restore) shell out to `npx quartz plugin <subcommand>`
- **Direct YAML I/O**: Configuration reads/writes operate directly on `quartz.config.yaml` and `quartz.lock.json`

## Documentation

See the [Quartz documentation](https://quartz.jzhao.xyz/) for more information.

## License

MIT
