const prisma = require('../config/prisma');

// فهرست تگ‌های قابل استفاده برای مشاور: تگ‌های پیش‌فرض + تگ‌های شخصی خودش
async function listTags(req, res, next) {
  try {
    const tags = await prisma.tag.findMany({
      where: {
        OR: [{ isDefault: true }, { advisorId: req.user.id }],
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    res.json({ tags });
  } catch (err) {
    next(err);
  }
}

// ساخت یک تگ شخصی جدید توسط مشاور
async function createTag(req, res, next) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'نام تگ الزامی است' });
    }

    const tag = await prisma.tag.create({
      data: { name: name.trim(), isDefault: false, advisorId: req.user.id },
    });

    res.status(201).json({ tag });
  } catch (err) {
    next(err);
  }
}

module.exports = { listTags, createTag };
