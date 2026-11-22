-- 001_init.sql —— 个人版基线 schema（设计稿 §2.2.3 v0.3.2 定稿口径）
-- 迁移机制：PRAGMA user_version 整数版本号，db.js 按文件名数字前缀顺序事务执行。

-- 1. 模具主档（物理表对齐企业版 SQL Server T_MD_Mould：表名 + 通用单据字段 + 已实证业务列同名，
--    便于后续与企业库直接对拷/对账。列名分两类：
--    · 企业已实证同名列 → 直接采用企业名（FInterID/FBillNo/FStatus/FMDNumber/FName/FModel/FType/FMDStatus/
--      FMDPlace/FDesignLife/FCreater/FCreateDate/FApproverID/FApproverDate/FORGID/FModifyTime）；
--    · 企业无直接对应或个人版特有列 → 保留英文蛇形并注释（used_shots/cavity_count/maint_interval_shots/
--      last_maint_shots/remark/cover_image_id/deleted_at）。
--    前端契约仍走 metaKey 中文键，物理列名变化由 personal.schema.js 的 dbCol 映射层吸收，零前端分叉。）
CREATE TABLE T_MD_Mould (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,           -- 单据内码（企业同名，主键）
  FBillNo TEXT DEFAULT '',                              -- 单据编号（通用，保存生成，如 MJ2611000021）
  FStatus INTEGER DEFAULT 0,                            -- 单据状态（通用：-1作废/0创建/1已审核/4已提交/6已关闭；默认 0 创建，审核此前从未开放、旧库默认 1 由 009 钩子一次性纠正）
  FMDNumber TEXT NOT NULL,                              -- 模具编号（企业同名，唯一，活动记录内）
  FName TEXT NOT NULL,                                  -- 模具名称（企业同名）
  FModel TEXT DEFAULT '',                               -- 规格/型号（企业 FModel 语义近似，对拷用）
  FType TEXT DEFAULT '',                                -- 类型（企业同名，dict_option: mold_type）
  FMDStatus TEXT DEFAULT '在库',                         -- 状态（企业同名）在库/生产中/保养中/维修中/报废
  FMDPlace TEXT DEFAULT '',                             -- 库位/存放地点（企业同名，dict_option: mold_location）
  FDesignLife INTEGER DEFAULT 0,                        -- 设计寿命模次（企业同名）
  used_shots INTEGER DEFAULT 0,                         -- 已用模次（个人版事务累加列，企业主档无直接对应）
  cavity_count INTEGER DEFAULT 1,                       -- 模穴数（个人版扩展，企业无）
  maint_interval_shots INTEGER DEFAULT 0,               -- 保养周期模次（个人版扩展，距下次保养 = 周期 - (已用-上次保养)）
  last_maint_shots INTEGER DEFAULT 0,                   -- 上次保养时累计模次（个人版扩展）
  remark TEXT DEFAULT '',                               -- 备注（企业主档列未实证，保留蛇形）
  FCreater TEXT DEFAULT '',                             -- 制单人（通用）
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')), -- 制单日期（企业同名）
  FApproverID TEXT DEFAULT '',                          -- 审核人（通用）
  FApproverDate TEXT,                                   -- 审核日期（通用）
  FORGID TEXT DEFAULT '',                               -- 组织内码（通用）
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')), -- 更新时间（个人版维护）
  cover_image_id INTEGER,                               -- 封面图（mold_image.id，个人版机制）
  deleted_at TEXT                                       -- 软删除时间戳（个人版软删机制，NULL=活动）
);
-- 坑 4：禁止表级 UNIQUE(FMDNumber)，软删后同号重建必须可行 → 部分唯一索引
CREATE UNIQUE INDEX idx_mold_code_active ON T_MD_Mould(FMDNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_mold_status_active ON T_MD_Mould(FMDStatus) WHERE deleted_at IS NULL;

-- 2. 图片索引（图存磁盘不入 BLOB；缩略图由前端 Canvas 生成经 FThumbImage 提交，服务端不切图）
CREATE TABLE mold_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mold_id INTEGER NOT NULL REFERENCES T_MD_Mould(FInterID),
  file_path TEXT NOT NULL,                         -- 相对 dataDir 的原图/压缩图路径
  thumb_path TEXT DEFAULT '',                      -- 320px 缩略图相对路径
  mime TEXT DEFAULT '',
  size_bytes INTEGER DEFAULT 0,
  is_cover INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_image_mold ON mold_image(mold_id);

-- 3. 部件/备件
CREATE TABLE mold_part (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mold_id INTEGER NOT NULL REFERENCES T_MD_Mould(FInterID),
  part_code TEXT DEFAULT '',
  name TEXT NOT NULL,
  spec TEXT DEFAULT '',
  qty INTEGER DEFAULT 0,
  replace_cycle_shots INTEGER DEFAULT 0,
  remark TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_part_mold ON mold_part(mold_id);

-- 4. 点检/保养/维修记录（轻量记录流，无单据审核）
CREATE TABLE maintenance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mold_id INTEGER NOT NULL REFERENCES T_MD_Mould(FInterID),
  log_type TEXT NOT NULL,                          -- 点检/保养/维修
  log_date TEXT NOT NULL,
  items_json TEXT DEFAULT '[]',                    -- 检查项与结果
  result TEXT DEFAULT '',                          -- 合格/异常/已修复
  cost REAL DEFAULT 0,
  shots_at_log INTEGER DEFAULT 0,                  -- 当时累计模次
  operator TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  image_ids_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_mlog_mold ON maintenance_log(mold_id, log_date DESC);

-- 5. 使用/打次记录（与 T_MD_Mould.used_shots 同事务原子累加）
CREATE TABLE usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mold_id INTEGER NOT NULL REFERENCES T_MD_Mould(FInterID),
  log_date TEXT NOT NULL,
  delta_shots INTEGER NOT NULL,
  machine_no TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_ulog_mold ON usage_log(mold_id, log_date DESC);

-- 6. 本地字典（模具类型/库位/点检项模板，用户可随手新增）
CREATE TABLE dict_option (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,                          -- mold_type / mold_location / inspect_item
  value TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX idx_dict_cat_val ON dict_option(category, value);

-- 7. 个人设置（视图偏好/预警阈值/自动备份策略）
CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value TEXT
);
