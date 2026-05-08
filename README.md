# WorkoutPlanner

A self-hosted local application for managing custom workout plans with flexible scheduling patterns based on your own video collection.

## About

WorkoutPlanner is a personal workout planning tool designed to help you organize and track workout routines using your own video resources. Unlike rigid, predefined weekly schedules, WorkoutPlanner lets you define custom workout patterns that fit your lifestyle—whether that's 3 days on, 1 day off, or any other pattern you prefer.

## Features

- **Local & Self-Hosted**: Run entirely on your own machine with no cloud dependency
- **Custom Workout Patterns**: Define your own workout schedules (e.g., 3 days workout → 1 day break → 2 days workout → 1 day break)
- **Video Storage Integration**: Add local paths to your video workout files
- **Bulk Upload Support**: Import workouts via TSV/CSV files for easy batch management
- **Responsive UI**: Track and manage your plans across desktop and mobile-friendly interface
- **Multi-language Support**: Available in English and Polish
- **No Subscription Required**: Complete control over your data and workout library

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn package manager

### Installation & Running Locally

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd WorkoutPlanner
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

## Adding Workouts

### Using TSV/CSV File Import

WorkoutPlanner supports bulk importing workouts from TSV (Tab-Separated Values) or CSV (Comma-Separated Values) files.

#### Sample TSV Format

```
[Placeholder for sample TSV file structure - to be added]
```

#### Creating Your Workout File

1. **Use the provided format** (see sample above)
2. **AI-Assisted Creation**: Feel free to use ChatGPT, Claude, or any AI assistant to help you structure and fill out your workout file. Simply provide them with the format template and your desired workouts
3. **File Requirements**: 
   - Ensure video file paths are absolute paths to files on your system
   - Double-check all path references before uploading
   - Keep file names UTF-8 compatible for cross-platform support

#### Important Notes on Video Sourcing

- **Responsible Sourcing**: Only use videos you have the right to use. This includes:
  - Your own original workout videos
  - Free, public domain workout content
  - Videos from creators who explicitly allow personal use
  - Downloaded copies of free YouTube workouts (respecting the creator's terms)
  
- **Respect Copyright**: Do not use copyrighted material without proper licensing

- **Disclaimer**: I am not responsible for how you source, store, or use video content within this application. It is your responsibility to ensure you comply with all applicable copyright laws and terms of service for any content you use.

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

[Add your license here]

## Support

For issues or feature requests, please open an issue in the repository.
