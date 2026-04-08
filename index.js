require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Supabase ──────────────────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ── Middleware ────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-admin-token']
}));
app.options('*', cors());
app.use(express.json());
app.use(express.static('public')); // Admin panel

// Rate limit: max 20 req/phut moi IP
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { ok: false, error: 'Qua nhieu yeu cau. Thu lai sau.' }
});
app.use('/api/', limiter);

// ── Auth middleware cho Admin ─────────────────────────────
function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (token !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ ok: false, error: 'Khong co quyen truy cap' });
    }
    next();
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API - Extension goi
// ═══════════════════════════════════════════════════════════

// POST /api/verify  — kiem tra key con han khong
app.post('/api/verify', async (req, res) => {
    const { key, machine_id } = req.body;

    if (!key || !machine_id) {
        return res.json({ ok: false, error: 'Thieu thong tin' });
    }

    const { data, error } = await supabase
        .from('license_keys')
        .select('*')
        .eq('key', key.trim().toUpperCase())
        .single();

    if (error || !data) {
        return res.json({ ok: false, error: 'Key khong ton tai' });
    }

    if (!data.is_active) {
        return res.json({ ok: false, error: 'Key da bi vo hieu hoa' });
    }

    const now = new Date();
    const expires = new Date(data.expires_at);
    if (now > expires) {
        return res.json({ ok: false, error: 'Key da het han' });
    }

    // Neu key chua gan may nao -> gan luon
    if (!data.machine_id) {
        await supabase
            .from('license_keys')
            .update({ machine_id, last_used: now.toISOString() })
            .eq('key', data.key);
    } else if (data.machine_id !== machine_id) {
        // Key dang dung tren may khac
        return res.json({ ok: false, error: 'Key nay dang duoc dung tren may khac' });
    } else {
        // Cap nhat last_used
        await supabase
            .from('license_keys')
            .update({ last_used: now.toISOString() })
            .eq('key', data.key);
    }

    const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

    return res.json({
        ok: true,
        plan: data.plan,
        expires_at: data.expires_at,
        days_left: daysLeft,
        note: data.note || ''
    });
});

// ═══════════════════════════════════════════════════════════
// ADMIN API — chi Bi dung
// ═══════════════════════════════════════════════════════════

// POST /api/admin/create — tao key moi
app.post('/api/admin/create', adminAuth, async (req, res) => {
    const { days = 30, plan = 'standard', note = '', quantity = 1 } = req.body;

    const results = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(days));

    for (let i = 0; i < Math.min(quantity, 50); i++) {
        // Format key: SDCU-XXXX-XXXX-XXXX
        const raw = uuidv4().replace(/-/g, '').toUpperCase();
        const key = `SDCU-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;

        const { data, error } = await supabase
            .from('license_keys')
            .insert({
                key,
                plan,
                note,
                expires_at: expiresAt.toISOString(),
                is_active: true,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (!error) results.push(data);
    }

    return res.json({ ok: true, keys: results });
});

// GET /api/admin/list — xem tat ca key
app.get('/api/admin/list', adminAuth, async (req, res) => {
    const { data, error } = await supabase
        .from('license_keys')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return res.json({ ok: false, error: error.message });
    return res.json({ ok: true, keys: data });
});

// PATCH /api/admin/toggle/:key — bat/tat key
app.patch('/api/admin/toggle/:key', adminAuth, async (req, res) => {
    const { key } = req.params;
    const { data: existing } = await supabase
        .from('license_keys')
        .select('is_active')
        .eq('key', key)
        .single();

    if (!existing) return res.json({ ok: false, error: 'Khong tim thay key' });

    const { data } = await supabase
        .from('license_keys')
        .update({ is_active: !existing.is_active })
        .eq('key', key)
        .select()
        .single();

    return res.json({ ok: true, key: data });
});

// PATCH /api/admin/reset/:key — reset machine_id (cho doi may)
app.patch('/api/admin/reset/:key', adminAuth, async (req, res) => {
    const { key } = req.params;
    const { data } = await supabase
        .from('license_keys')
        .update({ machine_id: null })
        .eq('key', key)
        .select()
        .single();

    return res.json({ ok: true, key: data });
});

// DELETE /api/admin/delete/:key — xoa key
app.delete('/api/admin/delete/:key', adminAuth, async (req, res) => {
    await supabase.from('license_keys').delete().eq('key', req.params.key);
    return res.json({ ok: true });
});

// PATCH /api/admin/extend/:key — gia han key
app.patch('/api/admin/extend/:key', adminAuth, async (req, res) => {
    const { days = 30 } = req.body;
    const { data: existing } = await supabase
        .from('license_keys')
        .select('expires_at')
        .eq('key', req.params.key)
        .single();

    if (!existing) return res.json({ ok: false, error: 'Khong tim thay key' });

    // Neu key da het han, tinh tu hom nay. Neu con han, cong them
    const base = new Date(existing.expires_at) > new Date()
        ? new Date(existing.expires_at)
        : new Date();
    base.setDate(base.getDate() + parseInt(days));

    const { data } = await supabase
        .from('license_keys')
        .update({ expires_at: base.toISOString() })
        .eq('key', req.params.key)
        .select()
        .single();

    return res.json({ ok: true, key: data });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Studocu Helper Server chay tai port ${PORT}`);
});
