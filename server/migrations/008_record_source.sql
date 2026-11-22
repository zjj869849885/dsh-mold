-- 008_record_source.sql —— b9 记录页「来源任务单号」回指列
-- 需求：点检/保养/维修任务单下推生成记录时回填来源任务单号，实现 任务单↔记录 双向可追溯
--   （对齐企业 FSourceBillNo 语义；个人版已剔除作业单类页，任务单就近承担执行角色）。
-- 库位/类型可维护化：MDLocation item 台账由 db.js seedDefaults 每启幂等灌入，无需本迁移建列。
ALTER TABLE T_MD_CheckRecord ADD COLUMN FSourceBillNo TEXT DEFAULT '';   -- 点检记录 ← 来源点检任务单号
ALTER TABLE T_MD_MainRecord  ADD COLUMN FSourceBillNo TEXT DEFAULT '';   -- 保养记录 ← 来源保养任务单号
ALTER TABLE T_MD_Server      ADD COLUMN FSourceBillNo TEXT DEFAULT '';   -- 维修记录 ← 来源维修任务单号
PRAGMA user_version = 8;
