import { state } from '../state.js';
import {
  escHtml, fmt, fmtMoney, contractEndIso, noopEndIso, getNextObservation,
  daysUntil, localDateStr, mktStateBadge, stripSuffix, contractStatus,
  isEnded, getEffectiveEndDate, calcAccruedCoupon, calcPerPeriodCoupon,
  calcAssignmentUnrealizedLoss, settlementLabel, MKT_BADGE, getUncheckedObsDates, calcSchedule
} from '../utils.js';

export function buildContractCard(c) {
  const today    = localDateStr(new Date());
  const endIso   = contractEndIso(c);
  const expired  = endIso && endIso < today;
  const noopEnd  = noopEndIso(c);
  const inNoop   = noopEnd && today <= noopEnd;
  const nextObs  = getNextObservation(c);

  // ── FCN 邏輯評估 ────────────────────────────────────────────────────
  const priceSource = isEnded(c) && c.frozenPrices ? c.frozenPrices : state.livePrices;
  const rowAlerts = {};
  let koAllAbove = !!(c.underlyings?.length);
  let hasKI      = false;

  c.underlyings?.forEach(u => {
    const live    = priceSource[u.symbol];
    if (!live?.ok || live.price == null) { koAllAbove = false; return; }
    const koPrice = c.koPercent ? u.basePrice * c.koPercent / 100 : null;
    const kiPrice = c.kiPercent ? u.basePrice * c.kiPercent / 100 : null;
    const aboveKO = koPrice != null && live.price >= koPrice;
    const atKI    = kiPrice != null && live.price <= kiPrice;
    if (!aboveKO) koAllAbove = false;
    if (atKI)     hasKI = true;
    rowAlerts[u.symbol] = atKI ? 'ki' : aboveKO ? 'ko_ready' : 'ok';
  });

  const koTriggered = !inNoop && !isEnded(c) && koAllAbove
    && Object.keys(rowAlerts).length === (c.underlyings?.length || 0);

  let cardState = '';
  if (!isEnded(c)) {
    if (hasKI) cardState = 'has-danger';
    else if (koTriggered) cardState = 'has-ko';
  }

  // ── 標的資料列 ──────────────────────────────────────────────────────
  const flag = MKT_BADGE[c.market] || '';
  const rows = (c.underlyings || []).map(u => {
    const live     = priceSource[u.symbol];
    const koPrice  = c.koPercent     ? u.basePrice * c.koPercent     / 100 : null;
    const kiPrice  = c.kiPercent     ? u.basePrice * c.kiPercent     / 100 : null;
    const stPrice  = c.strikePercent ? u.basePrice * c.strikePercent / 100 : null;
    const alertType  = rowAlerts[u.symbol];
    const memoryDate = state.settings?.memoryKO ? state.koMemory?.[c.id]?.[u.symbol] : null;

    let priceCell = '<span class="td-muted">—</span>';
    let chgCell = '', vsCell = '', alertCell = '<span class="td-muted">—</span>';

    if (live?.ok && live.price != null) {
      const p   = live.price;
      const pct = live.changePercent || 0;
      const dir = pct > 0.001 ? 'up' : pct < -0.001 ? 'down' : 'flat';
      const ms  = live.marketState || 'CLOSED';
      const isClosed = ms === 'CLOSED' || ms === 'POSTPOST';
      const pc  = live.prevClose;

      priceCell = `<span class="td-price">${fmt(p)}</span><span class="td-currency"> ${live.currency||''}</span> ${mktStateBadge(ms)}`
               + (!isClosed && pc != null ? `<div class="td-prev-close">昨收 ${fmt(pc)}</div>` : '');
      chgCell   = `<span class="change-pill ${dir}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`;
      if (u.basePrice) {
        const vb  = (p - u.basePrice) / u.basePrice * 100;
        vsCell = `<span class="vs-base ${vb >= 0 ? 'positive' : 'negative'}">${vb >= 0 ? '+' : ''}${vb.toFixed(2)}%</span>`;
      }
      const memoryTag = memoryDate ? `<div class="memory-ko-tag">🔔 KO 已記憶 ${memoryDate}</div>` : '';
      alertCell = alertType === 'ki'
        ? `<span class="alert-ki">⚠️ EKI 觸及 (${fmt(kiPrice)})</span>${memoryTag}`
        : alertType === 'ko_ready'
        ? `<span class="alert-ko-ready">✅ KO 達標</span>${memoryTag}`
        : `<span class="alert-ok">✓ 正常</span>${memoryTag}`;
    }

    const thStr = [
      koPrice != null ? `<span class="th-ko">KO ${fmt(koPrice)}</span><span class="th-pct">(${c.koPercent}%)</span>` : null,
      stPrice != null ? `<span class="th-st">Strike ${fmt(stPrice)}</span><span class="th-pct">(${c.strikePercent}%)</span>` : null,
      kiPrice != null ? `<span class="th-ki">EKI ${fmt(kiPrice)}</span><span class="th-pct">(${c.kiPercent}%)</span>` : null,
    ].filter(Boolean).join('<br>');

    return `<tr>
      <td>
        <div class="td-symbol">${flag} ${escHtml(stripSuffix(u.symbol))}</div>
        <div class="td-name">${escHtml(u.name || u.symbol)}</div>
      </td>
      <td>${priceCell}<div class="td-base">基準 ${fmt(u.basePrice)} ${u.currency||''}</div></td>
      <td>${chgCell}</td>
      <td>${vsCell}</td>
      <td class="threshold-cell">${thStr || '—'}</td>
      <td>${alertCell}</td>
    </tr>`;
  }).join('');

  // ── Meta chips ──────────────────────────────────────────────────────
  const chips = [];
  if (c.settlementMonths && c.settlementMonths !== 1) {
    chips.push(`<span class="card-meta-chip">💰 ${settlementLabel(c.settlementMonths)}結算</span>`);
  }
  if (c.noopMonths > 0) {
    chips.push(`<span class="card-meta-chip noop">🔒 不比價 ${c.noopMonths} 個月 (至 ${noopEnd})</span>`);
  }
  if (koTriggered)  chips.push(`<span class="card-meta-chip chip-ko-trigger">🌟 依現價有望 KO</span>`);
  if (!expired && nextObs && !inNoop) {
    const isExpiry = nextObs === endIso;
    const days = daysUntil(nextObs);
    const label = isExpiry ? '到期日' : '下次觀察';
    const extraCls = isExpiry && days <= 14 ? ' expiring-soon' : '';
    chips.push(`<span class="card-meta-chip next-settle${extraCls}">${label} ${nextObs}（${days}天後）</span>`);
  }
  
  // 為了防呆被寫入未來日期的舊資料，判斷 redeemedDate 是否真的成立
  const isValidRedeemed = c.redeemedDate && c.redeemedDate <= today;

  if (expired && !isValidRedeemed && !c.assignment) chips.push(`<span class="card-meta-chip expired">已到期 ${endIso}</span>`);
  if (isValidRedeemed) {
    const naturalEnd = contractEndIso(c);
    const isNaturalEnd = naturalEnd && c.redeemedDate >= naturalEnd;
    chips.push(isNaturalEnd
      ? `<span class="card-meta-chip chip-ended">✓ 已於結單日自然到期 (${c.redeemedDate})</span>`
      : `<span class="card-meta-chip chip-ko-trigger">KO 提前贖回 ${c.redeemedDate}</span>`
    );
  }
  if (c.assignment) chips.push(`<span class="card-meta-chip chip-assigned">EKI 接盤 ${c.assignment.date}</span>`);
  if (c.principal) {
    const cur       = c.underlyings?.[0]?.currency || '';
    const perPeriod = calcPerPeriodCoupon(c);
    const periodLbl = settlementLabel(c.settlementMonths);
    const accrued   = calcAccruedCoupon(c);
    chips.push(`<span class="card-meta-chip">💰 本金 ${fmtMoney(c.principal, cur)}`
      + (perPeriod ? `・${periodLbl}配息 ${fmtMoney(perPeriod, cur)}` : '')
      + (accrued   ? `・配息總額 ${fmtMoney(accrued, cur)}` : '')
      + `</span>`);
  }

  // ── 卡片狀態 CSS 與 Badge ──────────────────────────────────────────────
  const status = contractStatus(c);
  const naturalEnd = contractEndIso(c);
  const isNatural  = isValidRedeemed && naturalEnd && c.redeemedDate >= naturalEnd;
  
  let statusClass = '';
  // 如果未來日期錯誤存入，強制回歸 active
  if (!isValidRedeemed && !expired && !c.assignment) statusClass = 'status-active';
  else if (status === 'active')   statusClass = 'status-active';
  else if (status === 'assigned') statusClass = 'status-assigned';
  else if (status === 'redeemed' && !isNatural) statusClass = 'status-redeemed';
  else statusClass = 'status-ended';

  const badgeMap = {
    'status-active':   { cls: 'csb-active',   icon: '●',   label: '進行中' },
    'status-ended':    { cls: 'csb-ended',    icon: '✓',   label: '已到期' },
    'status-redeemed': { cls: 'csb-redeemed', icon: 'KO',  label: '提前贖回' },
    'status-assigned': { cls: 'csb-assigned', icon: 'EKI', label: '接盤' },
  };
  let badgeInfo = badgeMap[statusClass] || badgeMap['status-active'];
  if (statusClass === 'status-active' && hasKI)       badgeInfo = { cls: 'csb-danger', icon: '⚠️', label: 'EKI 觸及' };
  else if (statusClass === 'status-active' && koTriggered) badgeInfo = { cls: 'csb-ko', icon: '🔔', label: '有望 KO' };
  
  const statusBadgeHtml = `<span class="card-status-badge ${badgeInfo.cls}">${badgeInfo.icon} ${badgeInfo.label}</span>`;

  // ── 建立 DOM Element ──────────────────────────────────────────────────
  const card = document.createElement('div');
  const _actualEnded = isEnded(c) && (isValidRedeemed || expired || c.assignment);
  card.className = `contract-card ${statusClass} ${cardState}`;
  card.id = `card-${c.id}`;
  card.innerHTML = `
    <div class="card-top">
      <div class="card-top-left">
        <div class="card-contract-name">${escHtml(c.name || 'FCN 合約')}</div>
        <div class="card-meta">
          <span class="card-meta-chip">📅 ${c.startDate||'--'} → ${endIso||'--'}（${c.durationMonths}月）</span>
          ${chips.join('')}
        </div>
      </div>
      <div class="card-top-actions">
        ${statusBadgeHtml}
<button class="icon-btn" title="編輯合約" onclick="window.app.openEditModal('${c.id}')">✏️</button>
        <button class="icon-btn del" title="刪除" onclick="window.app.confirmDelete('${c.id}')">🗑️</button>
      </div>
    </div>
    <table class="underlying-table">
      <thead><tr>
        <th>標的</th><th>現價 / 基準</th><th>漲跌</th><th>對基準</th>
        <th>贖回 / 執行 / 下限</th><th>狀態</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // 自動判定通知 banner（最優先顯示）
  const noticeBanner = buildAutoNotice(c);
  if (noticeBanner) card.insertBefore(noticeBanner, card.firstChild);

  const histBanner = buildHistCardBanner(c);
  if (histBanner) {
    const table = card.querySelector('.underlying-table');
    if (table) card.insertBefore(histBanner, table);
    else card.appendChild(histBanner);
  }

  if (koTriggered) {
    const banner = document.createElement('div');
    banner.className = 'ko-trigger-banner';
    banner.textContent = '🚨 KO 條件達標：所有標的現價均已超過提前贖回門檻，下次觀察日可能觸發提前贖回！';
    card.appendChild(banner);
  }

  if (c.assignment) {
    const a = c.assignment;
    const u = (c.underlyings || []).find(x => x.symbol === a.symbol);
    const theorStrike = (u && c.strikePercent) ? u.basePrice * c.strikePercent / 100 : null;
    let diffHtml = '';
    if (theorStrike && a.actualPrice) {
      const diff = ((a.actualPrice - theorStrike) / theorStrike * 100);
      const cls = diff >= 0 ? 'pos' : 'neg';
      diffHtml = `<span class="assignment-diff ${cls}">(${diff >= 0 ? '+' : ''}${diff.toFixed(2)}% vs Strike)</span>`;
    }
    const cur = u?.currency || '';
    const assignEl = document.createElement('div');
    assignEl.className = 'assignment-section';
    assignEl.innerHTML = `
      <div class="assignment-title">
        📥 接盤記錄
        ${a.autoCalculated ? '<span class="assign-auto-tag">自動計算</span>' : ''}
        <button class="icon-btn assign-edit-btn" title="編輯接盤記錄" onclick="window.app.openAssignmentModal('${escHtml(c.id)}')">✏️ 編輯</button>
      </div>
      <div class="assignment-info">
        <span>標的：<strong>${escHtml(stripSuffix(a.symbol))}</strong></span>
        <span>日期：<strong>${escHtml(a.date)}</strong></span>
        <span>股數：<strong>${Number(a.shares).toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2})} 股</strong></span>
        <span>接盤價（Strike）：<strong>${fmt(a.actualPrice)} ${escHtml(cur)}</strong>${diffHtml}</span>
        ${theorStrike ? `<span>理論 Strike：<strong>${fmt(theorStrike)} ${escHtml(cur)}</strong></span>` : ''}
        ${c.principal ? `<span>接盤市值：<strong>${fmtMoney(a.actualPrice * a.shares, cur)}</strong></span>` : ''}
      </div>`;
    card.appendChild(assignEl);
  }

  return card;
}

function buildAutoNotice(c) {
  const notice = state.autoProcessedNotices?.[c.id];
  if (!notice) return null;

  let html, cls;
  if (notice.type === 'ko') {
    cls = 'auto-notice-ko';
    html = `🔔 系統自動判定：KO 提前贖回於 <strong>${notice.date}</strong>，合約已結算。如判定有誤請點 ✏️ 編輯修正。`;
  } else if (notice.type === 'ki_assigned') {
    const shares = notice.shares != null
      ? Number(notice.shares).toLocaleString('zh-TW', { minimumFractionDigits: 2 })
      : '--';
    cls = 'auto-notice-ki';
    html = `⚠️ 系統自動判定：到期日 EKI 接盤 <strong>${escHtml(stripSuffix(notice.symbol))}</strong>，Strike 價 <strong>${fmt(notice.strikePrice)}</strong>，接 <strong>${shares}</strong> 股（${notice.date}）。如判定有誤請點 ✏️ 編輯修正。`;
  } else {
    cls = 'auto-notice-natural';
    html = `✓ 系統自動判定：合約於 <strong>${notice.date}</strong> 自然到期結算。如判定有誤請點 ✏️ 編輯修正。`;
  }

  const el = document.createElement('div');
  el.className = `auto-notice ${cls}`;
  el.innerHTML = `
    <div class="auto-notice-body">${html}</div>
    <button class="btn btn-sm auto-notice-dismiss" onclick="window.app.dismissNotice('${escHtml(c.id)}')">已讀確認</button>
  `;
  return el;
}

export function buildHistCardBanner(c) {
  const { observationDates } = calcSchedule(c);
  const dates = getUncheckedObsDates(c);
  const today = localDateStr(new Date());
  
  // 計算發息紀錄
  const cur = c.underlyings?.[0]?.currency || '';
  const perPeriod = calcPerPeriodCoupon(c);
  const infoText = perPeriod ? `已發放: ${fmtMoney(perPeriod, cur)}` : '配息發放';
  
  let hasMissing = false, hasError = false;
  
  const pastDatesToRender = [];
  const effectiveEnd = getEffectiveEndDate(c) || today;

  const noopEnd = noopEndIso(c);

  observationDates.forEach(d => {
    // 合約提早結束後的日期：不會結算，略過
    if (d > effectiveEnd) {
      if (d > today) return; // 純未來日期不顯示

      // 組合取消原因文字
      let cancelledMsg = '已取消（合約提早終止）';
      if (c.redeemedDate && c.redeemedDate < (contractEndIso(c) || '')) {
        // KO 提前贖回：計算上次觀察日到 KO 日的部分利息
        const prevObs = [...observationDates].filter(od => od <= c.redeemedDate).pop();
        if (prevObs && c.principal && c.couponPercent && prevObs !== c.redeemedDate) {
          const days = Math.round(
            (new Date(c.redeemedDate + 'T00:00:00') - new Date(prevObs + 'T00:00:00')) / 86400000
          );
          const partial = c.principal * (c.couponPercent / 100) * days / 365;
          const cur = c.underlyings?.[0]?.currency || '';
          cancelledMsg = `KO 提前贖回（${c.redeemedDate}），額外 ${days} 天利息 ${fmtMoney(Math.round(partial * 100) / 100, cur)}`;
        } else {
          cancelledMsg = `KO 提前贖回（${c.redeemedDate}）後取消`;
        }
      }
      pastDatesToRender.push(`<li class="hist-cancelled-row">${d}：<span class="hist-cancelled">${cancelledMsg}</span></li>`);
      return;
    }

    // 尚未到的未來日期 → 不顯示（「下次觀察」chip 已提示）
    if (d > today) return;

    // 過去日期：優先使用 histCache 資料
    const key = `${c.id}__${d}`;
    const h = state.histCache[key];
    const inNoop = noopEnd && d <= noopEnd;

    if (!h) {
      hasMissing = true;
      pastDatesToRender.push(`<li>${d}：<span class="hist-missing">等待查詢...</span></li>`);
      return;
    }
    if (h.error || h.anyError) {
      hasError = true;
      pastDatesToRender.push(`<li>${d}：<span class="hist-error">無法取得完整收盤價</span></li>`);
      return;
    }

    let txt;
    if (inNoop) {
      // 不比價期間：只看 KI，不看 KO
      txt = h.hasKI
        ? `<span class="hist-ki">觸及 EKI！</span>（不比價，${infoText}）`
        : `不比價期間（${infoText}）`;
    } else if (!inNoop && h.koAllAbove) {
      txt = `<span class="hist-ko">KO 達標 → 提前贖回</span>`;
    } else if (h.hasKI) {
      txt = `<span class="hist-ki">觸及 EKI！</span>（${infoText}）`;
    } else if (h.isEnd) {
      txt = `<span class="hist-end">到期結算</span>（${infoText}）`;
    } else {
      txt = `正常（${infoText}）`;
    }

    pastDatesToRender.push(`<li>${d}：${txt}</li>`);
  });

  // 如果根本沒有結算日，就不顯示這個區塊
  if (!pastDatesToRender.length) return null;

  const el = document.createElement('div');
  el.className = 'hist-banner';
  const uncheckLength = dates.length;
  // 有未勾稽的紀錄時自動展開，否則預設收起
  el.innerHTML = `
    <details class="hist-banner-details" ${uncheckLength > 0 ? 'open' : ''}>
      <summary class="hist-banner-summary">
        <div class="hist-banner-title">
          <span class="icon-menu">≡</span> 歷史結算與派息紀錄
        </div>
      </summary>
      <div class="hist-banner-content">
        <ul class="hist-banner-list">
          ${pastDatesToRender.join('')}
        </ul>
      </div>
    </details>
  `;
  return el;
}
