# 🚀 KOLECT ADMIN - INSTRUCTIONS

## ✅ SETUP DÉTECTÉ :
- URL Backend : https://kolect-backend.onrender.com
- Tables : collaborators, scans, initiatives, initiative_contexts  

## 1️⃣ ÉTAPES :

### A) EXÉCUTER SQL
Copie le contenu de SQL_ADMIN_SETUP.sql dans PostgreSQL

### B) AJOUTER ROUTES DANS server.js
```javascript
// AJOUTER ces lignes dans ton server.js
const adminAuthRoutes = require('./routes/admin/auth');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminUsersRoutes = require('./routes/admin/users');

app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/admin', express.static('public/admin'));
```

### C) REDÉMARRER
Commit + push vers Render

## 2️⃣ ACCÈS :
- URL : https://kolect-backend.onrender.com/admin
- Email : admin@kolect.ch  
- Mot de passe : Devcom20!

## ✅ PRÊT !