🇵🇱 Polski: [README.pl.md](README.pl.md)

<p align="center">
  <img src="client/public/logo.png" alt="MyFitnessPlan Logo" width="120"/>
</p>
<h1 align="center">MyFitnessPlan - Open Source Self-Hosted Home Video Workout Planner</h1>

![](./screenshots/7.%20dashboard.jpg)
An open source, self-hosted local application for managing custom workout plans with flexible scheduling patterns based on your own video collection.

MyFitnessPlan is a personal workout planning tool designed to help you organize and track workout routines using your own video resources. Unlike rigid, predefined weekly schedules, MyFitnessPlan lets you define custom workout patterns that fit your lifestyle—whether that's 3 days on, 1 day off, or any other pattern you prefer.

## Features

### Upload TSV/CSV Workouts
![Upload TSV/CSV interface](./screenshots/1.%20intro.jpg)

Easily import your entire workout library using simple spreadsheet files. Support for both TSV and CSV formats makes it compatible with Excel, Google Sheets, and any spreadsheet software.

### Add Paths to Your Local Media
![Video library management](./screenshots/5.%20video%20library.jpg)

Link to your local workout video files directly on your computer. Keep full control over your video library without uploading anything to the cloud.

### Create Multiple Plans
![Multi-plan management](./screenshots/2.%20plans.jpg)

Build and manage multiple workout plans simultaneously. Switch between different routines whenever you want—perfect for varying your training intensity or style.

### Flexible Custom Patterns
![Custom workout patterns](./screenshots/3.%20workout%20pattern.jpg)

No hard-coded weekdays (Monday-Sunday). Define your own workout patterns: 3 days on/1 day off, 5 on/2 off, or any custom sequence that fits your lifestyle.

### Smart Workout Recognition
![Workout calendar and dashboard](./screenshots/4.%20workout%20calendar.jpg)

Works seamlessly with TSV/CSV files, automatically recognizing multiple workout entries per row. Mark individual exercises as done while tracking your progress through each workout session—complete flexibility in how you log your training.

### Personalization & Customization
![Color themes and customization](./screenshots/6.%20themes.jpg)

Make the app truly yours with customizable color themes and personalization options. Choose your preferred color scheme and adjust the interface to match your style.

### Additional Features
- **Local & Self-Hosted**: Run entirely on your own machine with no cloud dependency
- **Multi-language Support**: Available in English and Polish
- **No Subscription Required**: Complete control over your data and workout library
- **Privacy First**: All data stays on your computer

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn package manager

### Installation & Running Locally

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd <downloaded root folder>
   ```

2. **Install server dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install client dependencies**
   ```bash
   cd ../client
   npm install
   ```

4. **Start the server**
   ```bash
   cd ../server
   npm run dev
   ```
   The server will run on `http://localhost:3000` (or the port specified in your configuration)

5. **Start the client (in a new terminal)**
   ```bash
   cd client
   npm run dev
   ```
   The client will be available at `http://localhost:5173` (Vite default port)

6. **Open your browser** and navigate to the client URL shown in the terminal

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
└── README.md
```

## Available Scripts

### Client
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Server
- `npm run dev` - Start development server with auto-reload
- `npm run build` - Compile TypeScript
- `npm run start` - Run compiled server

## Configuration

Configuration files can be customized in:
- Client: `client/tsconfig.json`, `client/vite.config.ts`
- Server: `server/tsconfig.json`

## Troubleshooting

- **Port already in use**: Change the port in server configuration
- **Video paths not found**: Ensure absolute paths are correct and files exist
- **CORS issues**: Check server configuration for client URL

## License

This project is licensed under a **Non-Commercial Use License**.

### You are free to:
- Use the software for personal projects and self-hosted setups
- Modify and improve it for your own use
- Share it with others for non-commercial purposes
- Contribute improvements back to the project

### You **cannot**:
- Use this for commercial purposes or to earn revenue
- Redistribute it as a commercial product
- Sell access to this software or its features
- Use it as part of a paid service offering

For more details, see the [LICENSE](LICENSE) file.

---

**Created by:** [Klaudia Krzos](https://www.linkedin.com/in/klaudiacreativestuff/)  
**Company:** Big Deck IT LTD

## Support

For issues or feature requests, please open an issue in the repository.
