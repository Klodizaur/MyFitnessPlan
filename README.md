🇵🇱 Polski: [README.pl.md](README.pl.md)

<p align="center">
  <img src="client/public/logo.png" alt="MyFitnessPlan Logo" width="120"/>
</p>
<h1 align="center">MyFitnessPlan - Open Source Self-Hosted Home Video Workout Planner</h1>

![MyFitnessPlan dashboard](./screenshots/dashboard_orange.jpg)
An open source, self-hosted local application for managing custom workout plans with flexible scheduling patterns based on your own video collection.

MyFitnessPlan is a personal workout planning tool designed to help you organize and track workout routines using your own video resources. Unlike rigid, predefined weekly schedules, MyFitnessPlan lets you define custom workout patterns that fit your lifestyle—whether that's 3 days on, 1 day off, or any other pattern you prefer.

- **Website**: [myfitnessplan.bigdeckit.com](https://myfitnessplan.bigdeckit.com) — I try to keep it up to date, and it's the easiest way to see what it does
- **Download**: grab the latest macOS `.dmg` or Windows `.exe` from the [Releases page](https://github.com/Klodizaur/MyFitnessPlan/releases). No Node.js, npm, or terminal required.

## Features

### Import Workouts from Spreadsheets
![Importing a workout plan from a Google Sheet into MyFitnessPlan](./screenshots/1.%20import%20from%20spreadsheets.jpg)

Easily import your entire workout library using simple TSV or CSV spreadsheet files—compatible with Excel, Google Sheets, and any spreadsheet software. The dashboard picks up right where the sheet left off, showing today's workout and how much of it you've completed.

### Manage & Build Multiple Plans
![Managing and building workout plans, with a video picker for each day](./screenshots/2.%20manage%20and%20build%20workout%20plans.jpg)

Upload a plan, or build one from scratch day by day, week by week, straight from your video library. Keep several plans around and switch between them, or run two at once—a **main plan** alongside an **extra plan** (a short mobility or core block, for example) without one replacing the other.

### Flexible Custom Patterns
![Workout schedule pattern editor, toggling days between Workout and Rest](./screenshots/7.%20workout%20pattern.jpg)

No hard-coded weekdays. Define your own workout pattern—3 days on/1 day off, 5 on/2 off, or any custom cycle—and the calendar follows it instead of the calendar week.

### Calendar Views
![Weekly calendar cards showing completed workouts and their videos](./screenshots/3.%20workout%20calendar.jpg)

Browse your schedule as a classic card list, a slider, or the newer **Day Tape** view—a horizontal strip of days grouped by week with a dot marking workout days, expanding into a full detail view with thumbnail, duration, and tags. Need a break? Freeze a day, or a whole stretch, without losing any workouts—frozen days show the reason instead of a workout, and everything else shifts forward to make room.

### Built-in Player with Loop & Rest
![Built-in video player showing workout details, equipment, and intensity](./screenshots/4.%20built%20in%20player.jpg)

Play your videos without leaving the app, with the workout's focus, equipment, training type, and intensity right alongside it. The player can loop a video for a set number of passes with a rest between each one, plus a separate, usually longer rest before the next video in the plan begins—no more reaching for the seek bar between rounds.

### Local Video Library & Filtering
![Video library grouped by folder, with equipment, training type, and body part filters](./screenshots/6.%20library%20search%20%26%20filtering.jpg)

Point MyFitnessPlan at your local video folders and it scans and organizes them for you. Search, and filter by equipment, training type, body part, or intensity to find exactly the workout you're after—all without uploading a single file anywhere.

### Track Your Progress
![Activity log with workout stats and a monthly activity calendar](./screenshots/5.%20workout%20log.jpg)

See workouts done, active days, and a monthly activity calendar at a glance. Mark individual exercises as done and track your progress through each session—complete flexibility in how you log your training.

### Personalization & Themes
![The same dashboard shown in three different color themes](./screenshots/9.%20themes.jpg)

Make the app truly yours with several built-in color themes—from Midnight and Forest to Pastel Pink and Sky Blue—plus language and calendar-layout preferences, all from Settings.

### Additional Features
- **Freeze plans without losing progress**: pause a day or a whole stretch (sick day, time off, whatever) and every workout that would have landed there just moves to the next open day
- **Local & Self-Hosted**: run entirely on your own machine with no cloud dependency
- **Desktop app**: an installable macOS/Windows app that wraps the server and UI—no Node.js or terminal required (see [desktop/README.md](desktop/README.md))
- **Multi-language Support**: available in English and Polish
- **No Subscription Required**: complete control over your data and workout library
- **Privacy First**: all data stays on your computer

## Development & Contributing

Everything below this point is for people who want to run the app from source, build it themselves, or contribute.

### Prerequisites

- Node.js (v20 or higher)
- npm

### Installation & Running Locally

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd <downloaded root folder>
   ```

2. **Install dependencies** (installs the `client` and `server` workspaces)
   ```bash
   npm install
   ```

3. **Start the app**
   ```bash
   npm run dev
   ```
   This runs the server (`http://localhost:3000`) and the Vite client (`http://localhost:5173`) together.

4. **Open your browser** at `http://localhost:5173`

### Building the Desktop App Yourself

The `desktop/` folder packages MyFitnessPlan into the same standalone macOS `.dmg` or Windows `.exe` published on the Releases page (Linux builds are supported by the tooling too, just not published yet). See [desktop/README.md](desktop/README.md) for build instructions and where your data lives.

## ⚠️ Important Notice

**MyFitnessPlan does not provide any workout videos, content, or exercises.** You are entirely responsible for sourcing your own workout videos. The application is a planning and scheduling tool only. Please ensure all video content you use complies with copyright laws and terms of service. I am not responsible for how you use this application or any content you source.

## Adding Workouts

### Using TSV/CSV File Import

MyFitnessPlan supports bulk importing workouts from TSV (Tab-Separated Values) or CSV (Comma-Separated Values) files.

#### Example Workout Formats

Two example TSV files are provided in the `example_workout_sheets/` folder:

**Option 1: Simple Format (One Video Per Slot)**
- File: `Example workout plan - Simpler workout plan - one video per row.tsv`
- Best for: Simple workout schedules with one video per day/slot
- Structure:
  - First column: Week identifier
  - Remaining columns: Workout slots (Workout 1, Workout 2, etc.)
  - Fill cells with your workout names or video names
  - Leave cells empty for rest days

**Option 2: Multi-Video Format (Multiple Exercises Per Day)**
- File: `Example workout plan - Multi-video per day.tsv`
- Best for: Complex workouts with warmup, multiple exercises, and cooldown
- Structure:
  - First row: Week number and day labels (Mon, Tue, Wed, etc.)
  - First column: Exercise type (Warm up, Exercise 1, Exercise 2, etc.)
  - Each day gets its own column
  - Use "—" to indicate rest days or empty slots

#### How to Create Your Workout File

1. **Start with an example file** - Download one of the example TSV files from `example_workout_sheets/`

2. **Use an AI Assistant** - Take advantage of ChatGPT, Claude, or any AI tool:
   - Share the example file format with the AI
   - Provide your list of available workout videos
   - Ask the AI to maintain the exact same structure and layout
   - Have the AI create a customized workout plan based on your preferences
   - Example prompt: *"Here's a TSV file structure [paste format]. I have these workout videos available [list them]. Create a 4-week workout plan using this format, with 3 workout days and 1 rest day per week pattern."*

3. **Edit the file** - You can also manually edit the downloaded TSV file in Excel, Google Sheets, or any text editor

4. **Customize your schedule** - Modify to match your preferred workout pattern (3 on/1 off, 5 on/2 off, etc.)

#### File Requirements

- File format: `.tsv` (Tab-Separated Values) or `.csv` (Comma-Separated Values)
- **Video name matching**: Video file names must match or be very similar to the workout names in your spreadsheet. The app uses these names to locate and link your videos to the correct workouts. For example, if your spreadsheet says "30min Cardio Workout", your video file should be named something like "30min Cardio Workout.mp4" or "30min-Cardio-Workout.mp4"
- Video references: Use the actual names of your workout videos
- Rest days: Leave cells empty or use "—" to indicate no workout
- UTF-8 compatible for cross-platform support

#### Responsible Video Sourcing

You must source your own workout videos. Only use content you have the right to use:

✅ **Acceptable sources:**
- Your own original workout videos
- Free, public domain workout content
- Content from creators who explicitly allow personal use
- Downloaded copies of free YouTube workouts (respecting creators' terms and YouTube ToS)
- Licensed workout content you own

❌ **Not acceptable:**
- Copyrighted commercial workout programs without permission
- Unlicensed premium content from subscription services
- Content that violates creator terms of service

**Disclaimer**: I am not responsible for how you source, store, or use video content within this application. It is your responsibility to ensure you comply with all applicable copyright laws and terms of service for any content you use.

## Project Structure

```
WorkoutPlanner/
├── client/          # React/TypeScript frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── locales/
│   └── package.json
├── server/          # Node.js backend
│   ├── src/
│   │   ├── routes/
│   │   ├── db.ts
│   │   └── index.ts
│   └── package.json
├── desktop/         # Electron desktop wrapper (packages client + server)
├── example_workout_sheets/  # Example TSV plans
└── package.json     # Root workspace: `npm install` / `npm run dev`
```

## Available Scripts

### Root
- `npm install` - Install client + server workspace dependencies
- `npm run dev` - Start server and client together
- `npm run build` - Build client and server for production
- `npm run start` - Run the built server

### Client
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Server
- `npm run dev` - Start development server with auto-reload
- `npm run build` - Compile TypeScript
- `npm run start` - Run compiled server

### Desktop (run from `desktop/`)
- `npm start` - Run the desktop wrapper in development
- `npm run dist:mac` / `dist:win` / `dist:linux` - Build an installer for that platform

## Configuration

Configuration files can be customized in:
- Client: `client/tsconfig.json`, `client/vite.config.ts`
- Server: `server/tsconfig.json`

## Troubleshooting

- **Port already in use**: Change the port in server configuration
- **Video paths not found**: Ensure absolute paths are correct and files exist
- **CORS issues**: Check server configuration for client URL

## License

This project is licensed under the **MyFitnessPlan Community License**.

### You are free to:
- Run the software for your own use
- Modify the software
- Create and share your own modified versions
- Contribute improvements back to the project

### You **cannot**:
- Sell this software or modified versions of it
- Offer this software as a paid service or product
- Use this software as the basis of a commercial offering without written permission
- Remove copyright notices or claim the original work as your own

For more details, see the [LICENSE](LICENSE) file. For commercial licensing, contact hello@bigdeckit.com.

---

**Created by:** Klaudia Krzos — [LinkedIn](https://www.linkedin.com/in/klaudiacreativestuff/) · [GitHub](https://github.com/Klodizaur)

## Support

For issues or feature requests, please open an issue in the repository.
