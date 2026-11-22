-- 005_itembase.sql —— 个人版第四批·点检/保养基础资料 8 张 dp 台账 + 2 个 item 类别（MDChkItemType/MDMainItemType 复用 004 T_MD_Item）
-- 设计口径与 002/003 同族：FInterID 主键 + 审计 + deleted_at 软删 + 活动记录部分唯一索引；
-- 字段取企业 dp schema（docs/1.2）核心可编辑列，去 FORGID 组织/附件/派生带出列（企业「已有列属性」由下拉带出，个人版如实手录或留空）。
-- 项目类型/方案编码经 itemRef/refOf 联动（personal.pages.js 引擎扩展），不出企业内码值域。

-- 1. 点检项目（企业 203110 T_MD_CheckItem 精简：编码/类型/项目/要求/说明）
CREATE TABLE T_MD_ChkItem (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FNumber TEXT NOT NULL,                                  -- 点检项目编码（活动记录内唯一）
  FChkItemType TEXT DEFAULT '',                           -- 点检项目类型（itemRef: MDChkItemType 名称）
  FChkItem TEXT NOT NULL,                                 -- 点检项目
  FChkAsk TEXT DEFAULT '',                                -- 点检要求
  FExplain TEXT DEFAULT '',                               -- 说明
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_chkitemcode_active ON T_MD_ChkItem(FNumber) WHERE deleted_at IS NULL;

-- 2. 点检方案（企业 203111 T_MD_CheckSched 精简：去 B1 方案项目表体，单人版按说明维护）
CREATE TABLE T_MD_ChkSched (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FNumber TEXT NOT NULL,                                  -- 点检方案编码（活动记录内唯一）
  FName TEXT NOT NULL,                                    -- 点检方案名称
  FMouldNumber TEXT DEFAULT '',                           -- 模具编码（moldRef）
  FExplain TEXT DEFAULT '',                               -- 方案说明
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_chkschedcode_active ON T_MD_ChkSched(FNumber) WHERE deleted_at IS NULL;

-- 3. 点检作业配置（企业 203112 T_MD_CheckConfig 精简：单人无部门/执行人，加编码列成独立台账）
CREATE TABLE T_MD_ChkConfig (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FNumber TEXT NOT NULL,                                  -- 作业配置编码（活动记录内唯一）
  FType TEXT DEFAULT '时间周期',                           -- 配置类型（时间周期/模次周期）
  FCycleValue INTEGER NOT NULL DEFAULT 0,                 -- 循环值
  FCycTimeUnit TEXT DEFAULT '天',                          -- 循环时间单位（小时/天/周/月）
  FTriggerTime TEXT DEFAULT '',                           -- 触发时间 HH:mm
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_chkcfgcode_active ON T_MD_ChkConfig(FNumber) WHERE deleted_at IS NULL;

-- 4. 点检作业计划（企业 203113 T_MD_CheckPlan 精简：方案经 refOf 联动，日期核心 3 列）
CREATE TABLE T_MD_ChkPlan (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FScheNumber TEXT DEFAULT '',                            -- 点检方案编码（refOf: 203111）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FOpening INTEGER NOT NULL DEFAULT 0,                    -- 初始值
  FLastDate TEXT DEFAULT '',                              -- 上次点检时间
  FThisDate TEXT DEFAULT '',                              -- 本次点检时间
  FEndCheckDate TEXT DEFAULT '',                          -- 最后点检时间
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

-- 5. 保养项目（企业 203120 T_MD_MainItem 精简，与点检项目同构）
CREATE TABLE T_MD_MainItem (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FNumber TEXT NOT NULL,                                  -- 保养项目编码（活动记录内唯一）
  FMainItemType TEXT DEFAULT '',                          -- 保养项目类型（itemRef: MDMainItemType 名称）
  FMainItem TEXT NOT NULL,                                -- 保养项目
  FMainAsk TEXT DEFAULT '',                               -- 保养要求
  FExplain TEXT DEFAULT '',                               -- 说明
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_mainitemcode_active ON T_MD_MainItem(FNumber) WHERE deleted_at IS NULL;

-- 6. 保养方案（企业 203121 T_MD_MainScheme 精简：去 B1 表体，保留预计周期）
CREATE TABLE T_MD_MainSched (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FNumber TEXT NOT NULL,                                  -- 保养方案编码（活动记录内唯一）
  FName TEXT NOT NULL,                                    -- 保养方案名称
  FMouldNumber TEXT DEFAULT '',                           -- 模具编码（moldRef）
  FDueCycle INTEGER NOT NULL DEFAULT 0,                   -- 预计周期（天）
  FExplain TEXT DEFAULT '',                               -- 说明
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_mainschedcode_active ON T_MD_MainSched(FNumber) WHERE deleted_at IS NULL;

-- 7. 保养作业配置（企业 203122 T_MD_MainConfig 头仅 3 列，个人版加编码成独立台账）
CREATE TABLE T_MD_MainConfig (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FNumber TEXT NOT NULL,                                  -- 作业配置编码（活动记录内唯一）
  FType TEXT DEFAULT '时间周期',                           -- 配置类型（时间周期/模次周期）
  FCycleValue INTEGER NOT NULL DEFAULT 0,                 -- 循环值（Pcs/H）
  FCycTimeUnit TEXT DEFAULT '天',                          -- 循环时间单位
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_maintcfgcode_active ON T_MD_MainConfig(FNumber) WHERE deleted_at IS NULL;

-- 8. 保养作业计划（企业 203123 T_MD_MainPlan 精简：FEndDate 为驾驶舱保养到期判据）
CREATE TABLE T_MD_MainPlan (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FScheNumber TEXT DEFAULT '',                            -- 保养方案编码（refOf: 203121）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FOpening INTEGER NOT NULL DEFAULT 0,                    -- 初始值
  FLastDate TEXT DEFAULT '',                              -- 上次保养时间
  FStartDate TEXT DEFAULT '',                             -- 计划开始时间
  FEndDate TEXT DEFAULT '',                               -- 计划结束时间
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

PRAGMA user_version = 5;
