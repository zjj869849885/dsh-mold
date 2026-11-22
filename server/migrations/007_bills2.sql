-- 007_bills2.sql —— 个人版第六批：业务处理 12 单（203140-149/151/153）
-- 设计口径同 006：头表 FBillNo 由保存生成；软删 deleted_at；审计 DEFAULT localtime；体表 FEntryID 自增 + FInterID 归属。
-- 个人精简：去 FORGID/生产任务单/流转卡/工序/机台/班制/供应商/仓库仓位/销售订单/附件/源单系列等 ERP 专属列。

-- 1. 模具生产申领单（企业 203140 T_MD_PordApply）
CREATE TABLE T_MD_PordApply (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FApplyEmp TEXT DEFAULT '',                              -- 领用人
  FApplyTime TEXT DEFAULT '',                             -- 领用时间
  FOperatEmp TEXT DEFAULT '',                             -- 处理人
  FOperatTime TEXT DEFAULT '',                            -- 处理时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

-- 1b. 生产申领单表体 · B1（企业 T_MD_PordApplyEntry）
CREATE TABLE T_MD_PordApplyEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FMouldName TEXT DEFAULT '',                             -- 模具名称
  FApplyQty REAL DEFAULT 0,                               -- 申领数量
  FNote TEXT DEFAULT ''
);
CREATE INDEX idx_pordapplyent_head ON T_MD_PordApplyEntry(FInterID);

-- 2. 模具出库申请单（企业 203141 T_MD_OutboundApply）
CREATE TABLE T_MD_OutboundApply (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FApplyEmp TEXT DEFAULT '',                              -- 申请人
  FApplyTime TEXT DEFAULT '',                             -- 申请时间
  FExReceiveDate TEXT DEFAULT '',                         -- 预计领用时间
  FExReturn TEXT DEFAULT '',                              -- 预计归还时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

-- 2b. 出库申请单表体 · B1（企业 T_MD_OutboundApplyEntry）
CREATE TABLE T_MD_OutboundApplyEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FMouldName TEXT DEFAULT '',
  FOutMDNum TEXT DEFAULT '',                              -- 出库模次
  FOverLQty REAL DEFAULT 0,                               -- 出库申请数量
  FNote TEXT DEFAULT ''
);
CREATE INDEX idx_outboundapplyent_head ON T_MD_OutboundApplyEntry(FInterID);

-- 3. 模具领用记录单（企业 203142 T_MD_PickRecord）
CREATE TABLE T_MD_PickRecord (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FPickEmp TEXT DEFAULT '',                               -- 领用人
  FPickTime TEXT DEFAULT '',                              -- 领用时间
  FOperatEmp TEXT DEFAULT '',                             -- 处理人
  FOperatTime TEXT DEFAULT '',                            -- 处理时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

-- 3b. 领用记录单表体 · B1（企业 T_MD_PickRecordEntry）
CREATE TABLE T_MD_PickRecordEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FMouldName TEXT DEFAULT '',
  FPickQty REAL DEFAULT 0,                                -- 实际领用数量
  FNote TEXT DEFAULT ''
);
CREATE INDEX idx_pickrecordent_head ON T_MD_PickRecordEntry(FInterID);

-- 4. 模具归还记录单（企业 203143 T_MD_ReturnRecord）
CREATE TABLE T_MD_ReturnRecord (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FReturnEmp TEXT DEFAULT '',                             -- 归还人
  FReturnTime TEXT DEFAULT '',                            -- 归还时间
  FOperatEmp TEXT DEFAULT '',                             -- 处理人
  FOperatTime TEXT DEFAULT '',                            -- 处理时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

-- 4b. 归还记录单表体 · B1（企业 T_MD_ReturnRecordEntry）
CREATE TABLE T_MD_ReturnRecordEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FMouldName TEXT DEFAULT '',
  FReturnQty REAL DEFAULT 0,                              -- 归还数量
  FInMDNum TEXT DEFAULT '',                               -- 入库模次
  FNote TEXT DEFAULT ''
);
CREATE INDEX idx_returnrecordent_head ON T_MD_ReturnRecordEntry(FInterID);

-- 5. 模具接收单（企业 203144 T_MD_Receive，纯头）
CREATE TABLE T_MD_Receive (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FMouldName TEXT DEFAULT '',
  FReceiverType TEXT DEFAULT '',                          -- 接收类型
  FReceiverDate TEXT DEFAULT '',                          -- 接收日期
  FSupplier TEXT DEFAULT '',                              -- 供应商
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_receive_mold ON T_MD_Receive(FMouldNumber) WHERE deleted_at IS NULL;

-- 6. 模具验收单（企业 203145 T_MD_CheckAccept，纯头）
CREATE TABLE T_MD_CheckAccept (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,
  FMouldName TEXT DEFAULT '',
  FPassStatus TEXT DEFAULT '',                            -- 验收合格情况
  FResult TEXT DEFAULT '',                                -- 实际结果
  FConfirmEmp TEXT DEFAULT '',                            -- 确认人
  FInFTYDate TEXT DEFAULT '',                             -- 进厂日期
  FStartTime TEXT DEFAULT '',                             -- 验收开始时间
  FEndTime TEXT DEFAULT '',                               -- 验收结束时间
  FInitialMDNum REAL DEFAULT 0,                           -- 初始模次
  FTryProdMDNum REAL DEFAULT 0,                           -- 试产模次
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_checkaccept_mold ON T_MD_CheckAccept(FMouldNumber) WHERE deleted_at IS NULL;

-- 7. 模具报废单（企业 203146 T_MD_Scrap，纯头）
CREATE TABLE T_MD_Scrap (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,
  FMouldName TEXT DEFAULT '',
  FScrapReason TEXT DEFAULT '',                           -- 报废原因
  FExplain TEXT DEFAULT '',                               -- 说明
  FApplyEmp TEXT DEFAULT '',                              -- 申请人
  FApplyTime TEXT DEFAULT '',                             -- 申请时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_scrap_mold ON T_MD_Scrap(FMouldNumber) WHERE deleted_at IS NULL;

-- 8. 模具出厂申请单（企业 203147 T_MD_OutFactoryApply，纯头）
CREATE TABLE T_MD_OutFactoryApply (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,
  FMouldName TEXT DEFAULT '',
  FApplyEmp TEXT DEFAULT '',                              -- 申请人
  FApplyTime TEXT DEFAULT '',                             -- 申请时间
  FOutFTYDate TEXT DEFAULT '',                            -- 出厂日期
  FOutFTYReason TEXT DEFAULT '',                          -- 出厂原因
  FDest TEXT DEFAULT '',                                  -- 目的地
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_outfactoryapply_mold ON T_MD_OutFactoryApply(FMouldNumber) WHERE deleted_at IS NULL;

-- 9. 模具出厂审批单（企业 203148 T_MD_OutFactoryAudit，纯头）
CREATE TABLE T_MD_OutFactoryAudit (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,
  FMouldName TEXT DEFAULT '',
  FDest TEXT DEFAULT '',                                  -- 目的地
  FOutFTYDate TEXT DEFAULT '',                            -- 出厂日期
  FOutFTYReason TEXT DEFAULT '',                          -- 出厂原因
  FOutMDNum REAL DEFAULT 0,                               -- 出库模次
  FOperatEmp TEXT DEFAULT '',                             -- 处理人
  FOperatTime TEXT DEFAULT '',                            -- 处理时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_outfactoryaudit_mold ON T_MD_OutFactoryAudit(FMouldNumber) WHERE deleted_at IS NULL;

-- 10. 模具使用汇报单（企业 203149 T_MD_UseReport，纯头）
CREATE TABLE T_MD_UseReport (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,
  FMouldName TEXT DEFAULT '',
  FEmp TEXT DEFAULT '',                                   -- 汇报人
  FPreRptNum REAL DEFAULT 0,                              -- 汇报前模次
  FRptUseNum REAL DEFAULT 0,                              -- 汇报使用模次
  FUseTime REAL DEFAULT 0,                                -- 使用时长
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_usereport_mold ON T_MD_UseReport(FMouldNumber) WHERE deleted_at IS NULL;

-- 11. 模具盘点记录单（企业 203151 T_MD_Stocktaking）
CREATE TABLE T_MD_Stocktaking (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FDate TEXT DEFAULT '',                                  -- 盘点日期
  FEmp TEXT DEFAULT '',                                   -- 盘点人员
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

-- 11b. 盘点记录单表体 · B1（企业 T_MD_StocktakingEntry）
CREATE TABLE T_MD_StocktakingEntry (
  FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  FInterID INTEGER NOT NULL,
  FMouldNumber TEXT NOT NULL,                             -- 模具编码（moldRef）
  FMouldName TEXT DEFAULT '',
  FAccountQty REAL DEFAULT 0,                             -- 帐存数量
  FStocktakQty REAL DEFAULT 0,                            -- 盘点数量
  FPosition TEXT DEFAULT '',                              -- 存放地点
  FNote TEXT DEFAULT ''
);
CREATE INDEX idx_stocktakingent_head ON T_MD_StocktakingEntry(FInterID);

-- 12. 模具状态变更单（企业 203153 T_MD_StatusChange，纯头）
CREATE TABLE T_MD_StatusChange (
  FInterID INTEGER PRIMARY KEY AUTOINCREMENT,
  FBillNo TEXT DEFAULT '',
  FMouldNumber TEXT NOT NULL,
  FMouldName TEXT DEFAULT '',
  FMDStatus TEXT DEFAULT '',                              -- 当前状态
  FUpdateMDStatus TEXT DEFAULT '',                        -- 变更后状态
  FReceiverEmp TEXT DEFAULT '',                           -- 接收人
  FReceiverDate TEXT DEFAULT '',                          -- 接收时间
  FNote TEXT DEFAULT '',
  FCreateDate TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FModifyTime TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX idx_statuschange_mold ON T_MD_StatusChange(FMouldNumber) WHERE deleted_at IS NULL;

PRAGMA user_version = 7;
