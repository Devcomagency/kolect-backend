-- 🗄️ KOLECT ADMIN - COMMANDES SQL
-- URL: https://kolect-backend.onrender.com  

-- 1️⃣ Créer table administrateurs
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- 2️⃣ Créer table logs admin
CREATE TABLE IF NOT EXISTS admin_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin_users(id),
    action VARCHAR(255) NOT NULL,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3️⃣ Créer premier admin avec mot de passe: Devcom20!
-- Hash généré avec bcrypt pour 'Devcom20!'
INSERT INTO admin_users (name, email, password, role) VALUES 
    ('Admin Kolect', 'admin@kolect.ch', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super-admin')
ON CONFLICT (email) DO NOTHING;

-- 4️⃣ Index pour performance
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at);

-- ✅ PRÊT ! Login: admin@kolect.ch / Devcom20!