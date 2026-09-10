#!/usr/bin/env bash
# pg-pitr-maintenance.sh — 星河宠记 PITR 备份维护（2026-09-10 新增）
#
# 背景：2026-09-10 多会话改造部署时冒烟脚本误删 32 条真实对话，事后排查发现
#       archive_mode=off、无基础备份 → 完全不具备 PITR 能力，最坏丢一天数据。
#       当日已开启 WAL 归档并做首个基础备份；本脚本负责后续自动维护。
#
# 用途：
#   base  —— 每周日做基础备份（pg_basebackup），保留最近 KEEP_BASE 份
#   clean —— 每日清理 KEEP_WAL_DAYS 天前的 WAL 归档（配合每周基础备份，7 天窗口安全）
#
# 部署：服务器 /srv/ops/pg-pitr-maintenance.sh（仓库唯一事实源 05-部署配置/monitor/）
# cron：
#   10 4 * * 0  /srv/ops/pg-pitr-maintenance.sh base
#   30 4 * * *  /srv/ops/pg-pitr-maintenance.sh clean
#
# 恢复方法（PITR，需时参考）：
#   1. 解压 base.tar.gz + pg_wal.tar.gz 到新数据目录
#   2. 写 recovery.signal + restore_command='cp /var/backups/pg_wal_archive/%f %p'
#   3. recovery_target_time='YYYY-MM-DD HH:MM:SS+08' 指定恢复到的时间点
#   4. 启动实例验证后，再决定是否切回生产
set -euo pipefail

BASE_DIR=/var/backups/pg_basebackup
WAL_DIR=/var/backups/pg_wal_archive
KEEP_BASE=4
KEEP_WAL_DAYS=7
ENV_FILE=/etc/aixu-monitor.env
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

log() { echo "[$(date '+%F %T')] $*"; }

do_base() {
  local ts
  ts=$(date +%Y%m%d_%H%M)
  log "开始基础备份: $BASE_DIR/base_$ts"
  if sudo -u postgres pg_basebackup -D "$BASE_DIR/base_$ts" -Ft -z -X stream > "/tmp/pg_base_$ts.log" 2>&1; then
    log "基础备份成功: $(du -sh "$BASE_DIR/base_$ts" | cut -f1)"
  else
    log "基础备份失败，详见 /tmp/pg_base_$ts.log"
    if [ -n "${WEBHOOK_URL:-}" ]; then
      curl -fsS -m 10 -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' \
        -d '{"title":"[ALERT] 星河宠记 PITR 基础备份失败","desp":"pg_basebackup 失败，PITR 能力将失效，请检查服务器"}' >/dev/null 2>&1 || true
    fi
    exit 1
  fi
  # 只保留最近 KEEP_BASE 份基础备份
  ls -1dt "$BASE_DIR"/base_* 2>/dev/null | tail -n +$((KEEP_BASE + 1)) | while read -r d; do
    rm -rf "$d"
    log "清理旧基础备份: $d"
  done
}

do_clean() {
  # 清理 KEEP_WAL_DAYS 天前的 WAL 归档；因每周都做基础备份，7 天窗口内 PITR 始终可用
  find "$WAL_DIR" -type f -mtime +"$KEEP_WAL_DAYS" -delete 2>/dev/null || true
  log "WAL 归档清理完成：$(ls -1 "$WAL_DIR" 2>/dev/null | wc -l) 个文件 / $(du -sh "$WAL_DIR" 2>/dev/null | cut -f1)"
  # 顺带汇报归档健康度（failed_count 持续增长说明归档命令有问题）
  sudo -u postgres psql -tAc "SELECT 'archived=' || archived_count || ' failed=' || failed_count FROM pg_stat_archiver" 2>/dev/null | while read -r line; do
    log "归档统计: $line"
  done
}

case "${1:-}" in
  base) do_base ;;
  clean) do_clean ;;
  *) echo "用法: $0 {base|clean}"; exit 1 ;;
esac
