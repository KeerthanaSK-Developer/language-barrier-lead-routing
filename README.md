# BD Lead Routing System v2.0

Complete lead routing system with automatic assignment, email notifications, and capacity management.

## Quick Start

### 1. Start MongoDB
```bash
# macOS
brew services start mongodb-community@7.0

# Docker
docker run -d -p 27017:27017 --name mongodb mongodb:latest
```

### 2. Setup Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 init_db.py
uvicorn main:app --reload --port 8000
```

### 3. Setup Frontend
```bash
cd frontend
npm install
npm run dev
```

Access at http://localhost:3000

**Login credentials are printed when you run init_db.py**

## Key Features

### 1. Automatic Lead Routing
- Language-based matching
- Capacity limits (3 leads per BD)
- Lowest workload selection
- Pending leads queue

### 2. Password Generation
- Auto-generated passwords (name + phone pattern)
- Email delivery of credentials
- Secure password reset

### 3. Email Notifications
- User creation confirmation
- Lead assignment alerts
- Automatic pending lead assignment

### 4. Bulk Operations
- CSV user upload
- CSV lead upload
- Validation and error reporting

### 5. Complete Workflow
```
Lead Created → Check Language → Find BD with Capacity
                                      ↓
                              Auto-Assign & Email
                                      ↓
                              BD Completes Lead
                                      ↓
                              Automatic Pending Reassignment
```

## API Endpoints

### Authentication
- POST /api/auth/login
- POST /api/auth/create
- PUT /api/auth/reset-password

### Leads
- GET /api/leads/
- GET /api/leads/my-leads
- POST /api/leads/
- POST /api/leads/bulk-upload
- POST /api/leads/{id}/complete

### Dashboard
- GET /api/dashboard
- GET /api/pending-leads
- GET /api/bd-workload
- POST /api/bulk-users-upload

## Configuration

Edit `backend/.env`:

```env
# Email (required for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Company
COMPANY_NAME=Your Company
COMPANY_DOMAIN=company.com

# BD Capacity
MAX_ACTIVE_LEADS_PER_BD=3
```

## User Roles

### Admin
- Create Admin/BD users
- Upload leads (single/bulk)
- View all leads and BDs
- Monitor pending leads
- Reset password

### BD
- View assigned leads
- Complete leads
- Reset password

## Database Schema

### Users Collection
```js
{
  name: string,
  email: string (unique),
  phone: string,
  role: "admin" | "bd",
  password: string (hashed),
  supported_languages: array,
  status: "active" | "inactive",
  created_at: datetime
}
```

### BDs Collection
```js
{
  bd_id: string (user._id),
  name: string,
  email: string,
  phone: string,
  supported_languages: array,
  active_lead_count: number,
  status: "active" | "inactive",
  availability: boolean
}
```

### Leads Collection
```js
{
  lead_name: string,
  company: string,
  country: string,
  preferred_language: string,
  assigned_bd: string | null,
  status: "new" | "pending" | "assigned" | "completed",
  created_at: datetime,
  assigned_at: datetime,
  completed_at: datetime
}
```

## Routing Algorithm

```python
def route_lead(language):
    # Find BDs with:
    # - matching language
    # - active status
    # - < 3 active leads
    bds = find_compatible_bds(language)
    
    if not bds:
        # Add to pending
        add_to_pending_queue(lead)
        return
    
    # Select BD with lowest workload
    selected_bd = min(bds, key=active_lead_count)
    
    # Assign lead
    assign_lead(selected_bd)
    
    # Send email
    send_notification(selected_bd)
```

## Email Templates

### New User Account
- Welcome message
- Login credentials
- Reset password reminder

### Lead Assignment
- Lead details
- Company info
- Language requirement
- Dashboard link

## Security

- JWT tokens (8-hour expiry)
- Password hashing (bcrypt)
- Role-based access control
- Email validation
- Input sanitization

## Testing

### Create Admin
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"YOUR_PASSWORD"}'
```

### Create Lead
```bash
curl -X POST http://localhost:8000/api/leads/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lead_name":"Test","company":"ABC","country":"India","preferred_language":"Tamil"}'
```

## Production Notes

1. Change SECRET_KEY in .env
2. Configure email settings
3. Set up SSL/TLS for MongoDB
4. Enable CORS for your domain
5. Add rate limiting
6. Set up monitoring

## License

Internal company prototype.
