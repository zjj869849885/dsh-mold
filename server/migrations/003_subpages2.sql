-- 003_subpages2.sql —— 个人版补齐模具子页第二批（模具备件档案 203103 / 模具组 203104）
-- 设计口径与 002 同族：主档物理列名可拷、软删部分唯一索引、数字列 INTEGER/REAL 空串由 /save 权威 schema 判定不进契约。
-- 两表均带 FInterID 主键 + FCreateDate/FModifyTime 审计 + deleted_at 软删，dp 契约通用消费。

-- 1. 模具备件档案（企业 203103 T_MD_RelateSparePart 的个人精简独立台账：单人无组织/币别汇率/多仓，取核心档案列）
CREATE TABLE T_MD_Spare (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FSpareNumber TEXT NOT NULL,                             -- 备件编号（活动记录内唯一）
  FName TEXT NOT NULL,                                    -- 备件名称
  FModel TEXT DEFAULT '',                                 -- 备件型号
  FProperty TEXT DEFAULT '',                              -- 备件属性（dict_option: spare_property）
  FHelpCode TEXT DEFAULT '',                              -- 助记码
  FUnit TEXT DEFAULT '',                                  -- 基本单位
  FPrice REAL DEFAULT 0,                                  -- 单价
  FCurrency TEXT DEFAULT '人民币',                         -- 币别（人民币/美元/欧元）
  FStock TEXT DEFAULT '',                                 -- 默认仓库
  FStorageLoc TEXT DEFAULT '',                            -- 默认仓位
  remark TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_sparecode_active ON T_MD_Spare(FSpareNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_spare_property ON T_MD_Spare(FProperty) WHERE deleted_at IS NULL;

-- 2. 模具组（企业 203104 T_MD_MouldSmallType 的个人精简：编码/名称/所属模具类型）
CREATE TABLE T_MD_MoldGroup (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FGroupNumber TEXT NOT NULL,                             -- 组编码（活动记录内唯一）
  FName TEXT NOT NULL,                                    -- 组名称
  FMoldType TEXT DEFAULT '',                              -- 模具类型（dict_option: mold_type）
  remark TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_groupcode_active ON T_MD_MoldGroup(FGroupNumber) WHERE deleted_at IS NULL;
CREATE INDEX idx_group_type ON T_MD_MoldGroup(FMoldType) WHERE deleted_at IS NULL;
