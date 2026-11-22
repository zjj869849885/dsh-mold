-- 006_bills.sql —— 个人版第五批：维修 + 点检/保养闭环 8 张单据（203114/116/124/125/126/131/132/133）
-- 设计口径与 002/003 同族：单据头 FBillNo 由保存生成（billNoPrefix）；软删 deleted_at；审计列 DEFAULT localtime；
-- 表体逐页独立 Entry 表（FEntryID 自增），保存语义 = delete-by-FInterID + 逐行 insert（与企业 SHARED.cs 同源）。
-- 个人精简：去生产工单/流转卡/工序/班制/接收人等 MES 集成列与 FORGID/附件；审核态按个人版既有能力裁剪（billstatus 仅作废）。

-- 1. 模具点检任务单（企业 203114 T_MD_CheckTask）
CREATE TABLE T_MD_CheckTask (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 任务单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FScheNumber TEXT DEFAULT '',                            -- 点检方案编码（refOf 203111）
  FChkPlanStartTime TEXT DEFAULT '',                      -- 点检计划开始时间
  FChkPlanEndTime TEXT DEFAULT '',                        -- 点检计划结束时间
  FSourceBillNo TEXT DEFAULT '',                          -- 来源单据号
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_chktask_mold ON T_MD_CheckTask(FMouldNumber) WHERE deleted_at IS NULL;

-- 1b. 点检任务单表体 · B1 点检记录项目（企业 T_MD_CheckTaskEntry）
CREATE TABLE T_MD_CheckTaskEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,                              -- 所属任务单内码
  FChkItemType TEXT DEFAULT '',                           -- 点检项目类型（itemRef MDChkItemType）
  FChkItemNumber TEXT DEFAULT '',                         -- 点检项目编码（refOf 203110）
  FChkItem TEXT DEFAULT '',                               -- 点检项目
  FChkAsk TEXT DEFAULT '',                                -- 点检要求
  FChkValue REAL DEFAULT 0,                               -- 点检数值
  FChkResult TEXT DEFAULT '',                             -- 点检结果（正常/异常）
  FNote TEXT DEFAULT ''                                   -- 备注
);
CREATE INDEX idx_chktaskent_head ON T_MD_CheckTaskEntry(FInterID);

-- 2. 模具点检记录（企业 203116 T_MD_CheckRecord）
CREATE TABLE T_MD_CheckRecord (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 记录单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FScheNumber TEXT DEFAULT '',                            -- 点检方案编码（refOf 203111）
  FChkStartTime TEXT DEFAULT '',                          -- 点检开始时间
  FChkEndTime TEXT DEFAULT '',                            -- 点检结束时间
  FDuration TEXT DEFAULT '',                              -- 执行时长
  FHandler TEXT DEFAULT '',                               -- 处理人
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_chkrec_mold ON T_MD_CheckRecord(FMouldNumber) WHERE deleted_at IS NULL;

-- 2b. 点检记录表体 · B1 点检记录项目（企业 T_MD_CheckRecordEntry）
CREATE TABLE T_MD_CheckRecordEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FChkItemType TEXT DEFAULT '',                           -- 点检项目类型（itemRef）
  FChkItemNumber TEXT DEFAULT '',                         -- 点检项目编码（refOf 203110）
  FChkItem TEXT DEFAULT '',                               -- 点检项目
  FChkAsk TEXT DEFAULT '',                                -- 点检要求
  FChkValue REAL DEFAULT 0,                               -- 点检数值
  FChkResult TEXT DEFAULT '',                             -- 点检结果（正常/异常）
  FNote TEXT DEFAULT ''                                   -- 备注
);
CREATE INDEX idx_chkRecent_head ON T_MD_CheckRecordEntry(FInterID);

-- 2c. 点检记录表体 · B2 物资使用记录（企业 T_MD_CheckRecordEntry_A）
CREATE TABLE T_MD_CheckRecordEntry_A (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMtrlNumber TEXT DEFAULT '',                            -- 物资编码（refOf 203103 备件台账）
  FMtrlName TEXT DEFAULT '',                              -- 物资名称
  FMtrlUseQty REAL DEFAULT 0,                             -- 物资用量
  FUnit TEXT DEFAULT ''                                   -- 单位
);
CREATE INDEX idx_chkrecA_head ON T_MD_CheckRecordEntry_A(FInterID);

-- 3. 模具保养任务单（企业 203124 T_MD_MainTask）
CREATE TABLE T_MD_MainTask (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 任务单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FScheNumber TEXT DEFAULT '',                            -- 保养方案编码（refOf 203121）
  FMainPlanStartTime TEXT DEFAULT '',                     -- 保养计划开始时间
  FMainPlanEndTime TEXT DEFAULT '',                       -- 保养计划结束时间
  FSourceBillNo TEXT DEFAULT '',                          -- 来源单据号
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_maintask_mold ON T_MD_MainTask(FMouldNumber) WHERE deleted_at IS NULL;

-- 3b. 保养任务单表体 · B1 保养记录项目（企业 T_MD_MainTaskEntry）
CREATE TABLE T_MD_MainTaskEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMainItemType TEXT DEFAULT '',                          -- 保养项目类型（itemRef MDMainItemType）
  FMainItemNumber TEXT DEFAULT '',                        -- 保养项目编码（refOf 203120）
  FMainItem TEXT DEFAULT '',                              -- 保养项目
  FMainAsk TEXT DEFAULT '',                               -- 保养要求
  FMainResult TEXT DEFAULT '',                            -- 保养结果（正常/异常）
  FNote TEXT DEFAULT ''                                   -- 备注
);
CREATE INDEX idx_maintaskent_head ON T_MD_MainTaskEntry(FInterID);

-- 4. 模具保养作业单（企业 203125 T_MD_MainWork）
CREATE TABLE T_MD_MainWork (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 作业单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FScheNumber TEXT DEFAULT '',                            -- 保养方案编码（refOf 203121）
  FMainPlanStartTime TEXT DEFAULT '',                     -- 保养计划开始时间
  FMainPlanEndTime TEXT DEFAULT '',                       -- 保养计划结束时间
  FReceiver TEXT DEFAULT '',                              -- 接收人
  FReceiveDate TEXT DEFAULT '',                           -- 接收时间
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_mainwork_mold ON T_MD_MainWork(FMouldNumber) WHERE deleted_at IS NULL;

-- 4b. 保养作业单表体 · B1 保养记录项目（企业 T_MD_MainWorkEntry）
CREATE TABLE T_MD_MainWorkEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMainItemType TEXT DEFAULT '',                          -- 保养项目类型（itemRef）
  FMainItemNumber TEXT DEFAULT '',                        -- 保养项目编码（refOf 203120）
  FMainItem TEXT DEFAULT '',                              -- 保养项目
  FMainAsk TEXT DEFAULT '',                               -- 保养要求
  FMainResult TEXT DEFAULT '',                            -- 保养结果（正常/异常）
  FNote TEXT DEFAULT ''                                   -- 备注
);
CREATE INDEX idx_mainworkent_head ON T_MD_MainWorkEntry(FInterID);

-- 5. 模具保养记录（企业 203126 T_MD_MainRecord）
CREATE TABLE T_MD_MainRecord (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 记录单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FScheNumber TEXT DEFAULT '',                            -- 保养方案编码（refOf 203121）
  FMainStartTime TEXT DEFAULT '',                         -- 保养开始时间
  FMainEndTime TEXT DEFAULT '',                           -- 保养结束时间
  FDuration TEXT DEFAULT '',                              -- 执行时长
  FHandler TEXT DEFAULT '',                               -- 处理人
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_mainrec_mold ON T_MD_MainRecord(FMouldNumber) WHERE deleted_at IS NULL;

-- 5b. 保养记录表体 · B1 保养记录项目（企业 T_MD_MainRecordEntry）
CREATE TABLE T_MD_MainRecordEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMainItemType TEXT DEFAULT '',                          -- 保养项目类型（itemRef）
  FMainItemNumber TEXT DEFAULT '',                        -- 保养项目编码（refOf 203120）
  FMainItem TEXT DEFAULT '',                              -- 保养项目
  FMainAsk TEXT DEFAULT '',                               -- 保养要求
  FMainResult TEXT DEFAULT '',                            -- 保养结果（正常/异常）
  FNote TEXT DEFAULT ''                                   -- 备注
);
CREATE INDEX idx_mainRecent_head ON T_MD_MainRecordEntry(FInterID);

-- 5c. 保养记录表体 · B2 物资使用记录（企业 T_MD_MainRecordEntry_A）
CREATE TABLE T_MD_MainRecordEntry_A (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMtrlNumber TEXT DEFAULT '',                            -- 物资编码（refOf 203103 备件台账）
  FMtrlName TEXT DEFAULT '',                              -- 物资名称
  FMtrlUseQty REAL DEFAULT 0,                             -- 物资用量
  FUnit TEXT DEFAULT ''                                   -- 单位
);
CREATE INDEX idx_mainrecA_head ON T_MD_MainRecordEntry_A(FInterID);

-- 6. 模具维修任务单（企业 203131 T_MD_ServerTask，个人精简无表体）
CREATE TABLE T_MD_ServerTask (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 任务单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FRepairBillNo TEXT DEFAULT '',                          -- 来源报修单号
  FFaultDesc TEXT DEFAULT '',                             -- 报修内容
  FRequireDate TEXT DEFAULT '',                           -- 要求完成日期
  FHandler TEXT DEFAULT '',                               -- 接收人
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_srvtask_mold ON T_MD_ServerTask(FMouldNumber) WHERE deleted_at IS NULL;

-- 7. 模具维修作业单（企业 203132 T_MD_ServerWork，个人精简无表体）
CREATE TABLE T_MD_ServerWork (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 作业单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FRepairContent TEXT DEFAULT '',                         -- 维修内容
  FStartTime TEXT DEFAULT '',                             -- 实际开始时间
  FEndTime TEXT DEFAULT '',                               -- 实际完成时间
  FResult TEXT DEFAULT '',                                -- 维修结果
  FHandler TEXT DEFAULT '',                               -- 维修人
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_srvwork_mold ON T_MD_ServerWork(FMouldNumber) WHERE deleted_at IS NULL;

-- 8. 模具维修记录（企业 203133 T_MD_Server）
CREATE TABLE T_MD_Server (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',                                -- 记录单号（保存生成）
  FMouldNumber TEXT NOT NULL,                             -- 模具编码
  FRepairContent TEXT DEFAULT '',                         -- 维修内容/方案
  FPrincipal TEXT DEFAULT '',                             -- 负责人
  FRepairDate TEXT DEFAULT '',                            -- 维修日期
  FCheckDate TEXT DEFAULT '',                             -- 验收日期
  FResult TEXT DEFAULT '',                                -- 维修结果
  FCost REAL DEFAULT 0,                                   -- 维修费用
  FNote TEXT DEFAULT '',                                  -- 备注
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_srv_mold ON T_MD_Server(FMouldNumber) WHERE deleted_at IS NULL;

-- 8b. 维修记录表体 · B1 部件领用记录（企业 T_MD_ServerEntry）
CREATE TABLE T_MD_ServerEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FPartNumber TEXT DEFAULT '',                            -- 部件编码（refOf 203102 部件台账）
  FPartName TEXT DEFAULT '',                              -- 部件名称
  FModel TEXT DEFAULT '',                                 -- 规格型号
  FQty REAL DEFAULT 0,                                    -- 数量
  FUnit TEXT DEFAULT '',                                  -- 单位
  FNote TEXT DEFAULT ''                                   -- 备注
);
CREATE INDEX idx_srvent_head ON T_MD_ServerEntry(FInterID);

PRAGMA user_version = 6;
