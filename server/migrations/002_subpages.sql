-- 002_subpages.sql —— 个人版补齐模具子页（部件档案 203102 / 报修单 203130 / 点检·保养记录 203115）
-- 设计口径：沿用企业 dp 页「主档物理列名同名可拷」原则；软删部分唯一索引（坑 4 同 mold）；
-- 数字列 INTEGER/REAL，空串由 /save 服务端权威 schema 判定「不进契约」（与模具 NUMERIC_METAKEYS 同族加固）。
-- 三表均带 FInterID 主键 + FCreateDate/FModifyTime 审计 + deleted_at 软删，dp 契约（/filter /data /billinit /detail /save /billstatus）通用消费。

-- 1. 部件档案（企业 模具部件档案 203102 的个人精简独立台账）
CREATE TABLE T_MD_Part (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FPartNumber TEXT NOT NULL,                              -- 部件编号（活动记录内唯一）
  FName TEXT NOT NULL,                                    -- 部件名称
  FModel TEXT DEFAULT '',                                 -- 规格/型号
  FMouldNumber TEXT DEFAULT '',                           -- 所属模具编号（按模具编号 loose 关联，非外键）
  FPartType TEXT DEFAULT '',                              -- 部件类型（dict_option: part_type）
  qty INTEGER DEFAULT 0,                                  -- 数量
  replace_cycle_shots INTEGER DEFAULT 0,                  -- 更换周期模次
  FMDStatus TEXT DEFAULT '在用',                           -- 状态（在用/备用/已更换/报废）
  remark TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_partcode_active_sub ON T_MD_Part(FPartNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_part_mold_sub ON T_MD_Part(FMouldNumber) WHERE deleted_at IS NULL;

-- 2. 报修单（企业 模具报修单 203130 的个人精简：单人无审批流，状态仅作台账标记）
CREATE TABLE T_MD_Repair (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 报修单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 报修模具编号
  FFaultDesc TEXT NOT NULL,                               -- 故障描述
  FReporter TEXT DEFAULT '',                              -- 报修人
  FRepairDate TEXT NOT NULL DEFAULT (date('now','localtime')), -- 报修日期
  FStatus TEXT DEFAULT '待处理',                           -- 处理状态（待处理/维修中/已修复/已关闭）
  FHandler TEXT DEFAULT '',                               -- 维修负责人
  FFinishDate TEXT DEFAULT '',                            -- 完成日期
  FResult TEXT DEFAULT '',                                -- 处理结果
  cost REAL DEFAULT 0,                                    -- 维修费用
  remark TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_repair_mold ON T_MD_Repair(FMouldNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_repair_status ON T_MD_Repair(FStatus) WHERE deleted_at IS NULL;

-- 3. 点检·保养记录（企业点检作业单 203115 + 保养作业单 203125 合并为一条轻量记录流台账，设计稿 §2.2.4 maintenance 行）
CREATE TABLE T_MD_Maint (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 记录单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编号
  FLogType TEXT NOT NULL DEFAULT '点检',                   -- 作业类型（点检/保养）
  FChkDate TEXT NOT NULL DEFAULT (date('now','localtime')), -- 作业日期
  FItems TEXT DEFAULT '',                                 -- 检查/保养项目
  FResult TEXT DEFAULT '合格',                             -- 结果（合格/异常/已保养）
  FOperator TEXT DEFAULT '',                              -- 作业人
  shots_at_log INTEGER DEFAULT 0,                         -- 当时累计模次
  cost REAL DEFAULT 0,                                    -- 费用
  remark TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_maint_mold ON T_MD_Maint(FMouldNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_maint_type ON T_MD_Maint(FLogType) WHERE deleted_at IS NULL;
