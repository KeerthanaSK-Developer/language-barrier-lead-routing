# BD Lead Routing System - Startup Guide

## IMPORTANT: First Time Setup

Follow these steps exactly to get the system running.

---

## Step 1: Install MongoDB

### Option A: Using Homebrew (macOS)
```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

### Option B: Using Docker
```bash
docker run -d -p 27017:27017 --name mongodb mongodb:latest
```

### Option C: Download directly
Visit: https://www.mongodb.com/try/download/community

---

## Step 2: Configure Email (Optional but Recommended)

Edit `backend/.env` and add your email settings:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=your-email@gmail.com
```

**For Gmail:**
1. Enable 2-factor authentication
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the app password in SMTP_PASSWORD

---

## Step 3: Initialize Backend

Open Terminal #1:
```bash
cd bd-lead-routing/backend

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Initialize database and CREATE USERS
python3 init_db.py

# WRITE DOWN THE PASSWORDS SHOWN!

# Start server
uvicorn main:app --reload --port 8000
```

You will see output like:
```
============================================================
CREDENTIALS FOR LOGIN (IMPORTANT - SAVE THESE!)
============================================================

Admin Account Created:
  Name: System Admin
  Email: admin@company.com
  Password: systemadmin3210_847
  Role: Admin

Admin Account Created:
  Name: Super Admin
  Email: superadmin@company.com
  Password: superadmin3211_392
  Role: Admin
```

**SAVE THESE PASSWORDS!**

---

## Step 4: Start Frontend

Open Terminal #2:
```bash
cd bd-lead-routing/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

---

## Step 5: Login

1. Open browser: http://localhost:3000
2. Use one of the admin accounts created
3. You'll be redirected to Admin Dashboard

---

## Using the System

### As Admin:

#### Create New Users
1. Click "Create Users" in sidebar
2. Fill in: Name, Email, Phone, Role
3. For BD: Select supported languages
4. Click "Create User"
5. Password auto-generated and emailed

#### Upload Leads
1. Go to "Leads" page
2. Click "Add Lead" (single) or "Bulk Upload" (CSV)
3. System automatically routes to BD based on:
   - Language match
   - BD availability
   - Lowest workload

#### Monitor BDs
1. Go to "BD Team" page
2. See all BDs with:
   - Supported languages
   - Active lead count
   - Available capacity
3. Click "View Details" to see assigned leads

#### Check Pending Leads
1. Go to "Pending Leads" page
2. See leads waiting for assignment
3. These auto-assign when BD capacity opens

---

### As BD:

#### View My Leads
1. Login with BD credentials
2. Automatically see "My Leads" page
3. Each lead shows:
   - Company, Country
   - Preferred Language
   - Status
   - Assigned date

#### Complete a Lead
1. Click "Complete" button on lead
2. System will:
   - Mark lead as completed
   - Decrease your active count
   - Check pending leads
   - Automatically assign next lead if matching

#### Reset Password
1. Click "Reset Password" in sidebar
2. Enter current password
3. Enter new password

---

## Business Rules

### BD Capacity
- Maximum: 3 active leads per BD
- Status indicators:
  - 0-2 leads: "Available"
  - 3 leads: "Full"

### Language Routing
- Exact match required
- Example: Tamil lead → BD who speaks Tamil
- If match found + capacity → Auto-assign

### Pending Leads
- Created when:
  - No BD speaks lead's language
  - All matching BDs at full capacity
- Auto-assign when capacity opens

### Auto-Assignment Flow
```
BD Completes Lead
      ↓
Active Count - 1
      ↓
Check Pending Leads Queue
      ↓
Language Match Found?
      ↓
Auto-Assign Oldest Matching Lead
      ↓
Send Email Notification
```

---

## CSV Upload Format

### Users CSV
```csv
Name,Email,Phone,Role,Supported Languages
Arun,arun@company.com,9876543210,BD,Tamil|English
Priya,priya@company.com,9876543211,BD,Hindi|English|Telugu
John,john@company.com,9876543212,Admin,
```

### Leads CSV
```csv
Lead Name,Company,Country,Preferred Language
Chennai Tech,ABC Pvt,India,Tamil
Madrid Soft,XYZ Inc,Spain,Spanish
Berlin Digital,DEF Gmbh,Germany,German
```

---

## Troubleshooting

### MongoDB Connection Error
```bash
# Check if MongoDB is running
brew services list

# Start it
brew services start mongodb-community@7.0
```

### CORS Error
Backend already configured for CORS. If issues persist, check that backend is running on port 8000.

### Email Not Sending
1. Check SMTP settings in .env
2. For Gmail, use App Password (not regular password)
3. Check spam folder

### Login Fails
1. Check that init_db.py ran successfully
2. Copy password exactly as shown
3. Check MongoDB has users collection

---

## API Documentation

Visit http://localhost:8000/docs for interactive API docs.

---

## Support

This is an internal prototype. For issues or questions, contact the development team.
