# BD Lead Routing System - Frontend

This is the React.js frontend for the BD Lead Routing System.

## Setup Instructions

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start Development Server
```bash
npm run dev
```

The application will start at http://localhost:3000

### 3. Build for Production
```bash
npm run build
```

## Features

### Login Page
- Admin and BD user authentication
- Token-based authentication
- Session management

### Dashboard
- Real-time statistics
- Recent routing activity
- Language mismatch alerts
- Quick navigation to unassigned leads

### Leads Table
- Comprehensive lead list with all details
- Search and filter functionality
- Create, edit, and delete leads (Admin only)
- Automatic language routing trigger
- Status badges and routing indicators

### BD Team Management
- View all Business Development representatives
- See supported languages for each BD
- Current lead count
- Availability toggle (Admin only)
- Add/Edit BD profiles

### Routing History
- Timeline view of all routing events
- Automatic vs manual routing distinction
- Detailed routing reasons
- Timestamp tracking

### Unassigned Leads
- Leads requiring manual assignment
- Language matching suggestions
- Manual assignment interface (Admin only)
- Warning for unsupported languages

## Auto-Routing Logic

When a lead is created or updated:

1. System checks the lead's preferred language
2. If assigned BD supports the language → No action
3. If language mismatch detected:
   - Find all available BDs supporting that language
   - Select BD with lowest current lead count
   - Automatically reassign and record in history
   - Show notification to user
4. If no matching BD found:
   - Mark as "manual-review"
   - Show in Unassigned Leads section
   - Allow Admin to manually assign

## Test Credentials

### Admin User
- Username: `admin`
- Password: `admin123`

### BD Users
- Username: `arun`, `david`, `priya`, `michael`
- Password: `bd123`

## Supported Languages
- English, Tamil, Hindi, Telugu
- Spanish, French, German
- Kannada, Malayalam

## Tech Stack

- React 18
- Vite (build tool)
- React Router v6
- Axios
- Tailwind CSS
- Lucide React (icons)
- React Hot Toast (notifications)
