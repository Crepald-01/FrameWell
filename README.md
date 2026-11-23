# Framewell

Framewell is a local video editor with a layered timeline, motion keyframes, TypeScript and React authoring, and an MCP server for an external AI client. Projects, media, and renders stay on the computer.

[Watch the 10-second launch video](./Framewell%20Launch.mp4) or open the [editable motion source](./examples/launch/Launch.tsx).

## Install and run on Windows

### 1. Install Node.js and FFmpeg

Framewell needs Node.js 24.10 or later and FFmpeg with `ffprobe`. In PowerShell, run the command for each prerequisite you still need.

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Gyan.FFmpeg --exact
```

Open a new PowerShell window after installing them.

### 2. Set up Framewell once

On GitHub, select **Code → Download ZIP** and extract it. Open PowerShell in the extracted folder containing `package.json` and run these three commands.

```powershell
npm.cmd ci
npm.cmd run setup:renderer
npm.cmd run build
```

### 3. Launch the editor

Run this from the Framewell folder each time you want to open the editor.

```powershell
npm.cmd start
```

When PowerShell says **Framewell is ready**, open [http://127.0.0.1:4785](http://127.0.0.1:4785) in your browser. Keep PowerShell open while you edit. Press **Ctrl+C** there to stop Framewell.

To use AI editing, see [Connect an AI client](#connect-an-ai-client).

## Edit a composition

1. Create a project and choose its canvas and frame rate. Import media from the Media panel, then drag a file to the timeline or use its **Add at playhead** button.
2. Drag a clip or its ends to move or trim it. Stacked video tracks composite from top to bottom, with the upper tracks in front. For overlapping clips, place them on separate tracks.
3. Select a clip to edit it in Inspector. Move the playhead inside the clip and use the diamond next to a transform property to add or remove a keyframe. Select a keyframe to change the easing to the next keyframe.
4. Choose **Export** to queue an MP4 of the current revision. The export keeps that revision if you continue editing. Completed files are available from the export dialog and the local `exports` folder.

Use Space to play or pause, Left and Right to step, S to split a selected clip at the playhead, Delete to remove it, and Ctrl+Z or Ctrl+Shift+Z for Undo and Redo. The timeline also provides mouse and keyboard controls for these actions.

## Author in code

- **Layer script** — Export `build({ width, height, fps, playhead, assets })`. Return an array of tracks with a `name`, optional `kind` (`visual` or `audio`), and a `clips` array. Each clip needs a `kind`, `name`, `start`, and `duration`. Positions and durations are integer frames, and starts are relative to the playhead. A clip can also specify its asset or source, transform, keyframes, and style. **Run script** inserts ordinary editable layers in one edit.
- **React clip** — Default-export a React component that takes `{ frame, fps, width, height, props }`. Compute motion from the clip-local frame. Export a `defaults` object of strings, finite numbers, or booleans to make those properties editable in Inspector. Save the file, then choose **Add to timeline**.
- **Module** — Import saved project modules with relative paths. The built-in `@framewell/sdk` exports `clamp`, `lerp`, `interpolate`, `easeOut`, `easeInOut`, and seeded `random`.

React clips support static HTML and SVG with inline styling. Use frame-driven values for animation and ordinary timeline layers for video, images, and audio. The Code workspace includes working source templates for both authoring modes.

## Connect an AI client

Framewell exposes an MCP server over standard input and output. Set the client's command to `node` with the absolute path to `server/mcp.mjs` as the first argument. For clients that use TOML, use the following configuration and substitute your actual path.

```toml
[mcp_servers.framewell]
command = "node"
args = ['C:\path\to\framewell\server\mcp.mjs']
```

Keep the Framewell service running while you use the tools. Start with `list_projects` and `get_project`. Use `apply_edits` to commit a named batch with the current revision. If the project changes before the batch commits, read the latest revision and adjust the edit. Use the same `requestId` when retrying an identical batch after a connection error.

`inspect_frame` returns a composition frame to the AI client. `import_media` accepts filenames from the Framewell `inbox` folder. `run_layer_script` inserts generated layers, and `start_export`, `get_export`, and `cancel_export` control MP4 export jobs. Changes made by the MCP client appear in the editor and are recorded in project history.

## Local files and settings

On Windows, Framewell stores projects, copied media, and finished exports in `%LOCALAPPDATA%\Framewell`. Set `FRAMEWELL_DATA_DIR` to an absolute path to use a different folder. Set `FRAMEWELL_FFMPEG` and `FRAMEWELL_FFPROBE` if you need to specify executable paths.

The editor uses port 4785. Port 4786 hosts the isolated code runtime. Both ports bind to the loopback address.
