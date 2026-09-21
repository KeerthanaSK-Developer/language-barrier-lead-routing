# BD Lead Routing System - Backend

## Setup Instructions

### 1. Install MongoDB
```bash
# On macOS
brew install mongodb-community@7.0
brew services start mongodb-community@7.0

# On Ubuntu/Debian
sudo apt-get install mongodb
sudo systemctl start mongodb
```

### 2. Install Python Dependencies
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Initialize Database
```bash
python init_db.py
```

### 4. Run the Server
```bash
uvicorn main:app --reload --port 8000
```

## API Documentation
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Login Credentials

### Admin User
- Username: `admin`
- Password: `admin123`

### BD Users
- Username: `arun`, `david`, `priya`, `michael`
- Password: `bd123`

## API Endpoints

### Authentication
- POST `/api/auth/login` - User login
- GET `/api/auth/me` - Get current user

### Leads
- GET `/api/leads/` - Get all leads
- POST `/api/leads/` - Create new lead
- PUT `/api/leads/{lead_id}` - Update lead
- DELETE `/api/leads/{lead_id}` - Delete lead
- POST `/api/leads/{lead_id}/manual-assign/{bd_id}` - Manual assignment

### BDs
- GET `/api/bds/` - Get all BDs
- POST `/api/bds/` - Create BD (Admin only)
- PUT `/api/bds/{bd_id}` - Update BD (Admin only)
- DELETE `/api/bds/{bd_id}` - Delete BD (Admin only)

### Dashboard
- GET `/api/dashboard` - Get dashboard statistics
- GET `/api/routing-history` - Get routing history
- GET `/api/unassigned-leads` - Get unassigned leads
