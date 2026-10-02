(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_KEY && !cfg.SUPABASE_URL.startsWith('DEINE_') && !cfg.SUPABASE_KEY.startsWith('DEIN_');
  const client = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;

  const $ = (id) => document.getElementById(id);
  const screens = ['configScreen', 'appScreen'];
  const categories = [
    { key: 'clothes', name: 'Klamotten', icon: '👕' },
    { key: 'sports', name: 'Sportsachen', icon: '⚽' },
    { key: 'shoes', name: 'Schuhe', icon: '👟' }
  ];

  let household = null;
  let settings = [];
  let purchases = [];
  let selectedYear = new Date().getFullYear();
  let selectedQuarter = Math.floor(new Date().getMonth() / 3) + 1;

  function showScreen(id) {
    screens.forEach((screenId) => $(screenId).classList.toggle('hidden', screenId !== id));
  }

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    setTimeout(() => $('toast').classList.add('hidden'), 2600);
  }

  const money = (value) => new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(value || 0));

  const dateDE = (value) => new Intl.DateTimeFormat('de-DE').format(new Date(`${value}T12:00:00`));

  function quarterIndex(year, quarter) {
    return year * 4 + (quarter - 1);
  }

  function quarterStart(year, quarter) {
    return `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  }

  function quarterEnd(year, quarter) {
    const d = new Date(year, quarter * 3, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function categoryName(key) {
    return categories.find((c) => c.key === key)?.name || key;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c]));
  }

  async function init() {
    if (!configured) {
      showScreen('configScreen');
      return;
    }

    const { data, error } = await client
      .from('households')
      .select('id,name,join_code')
      .eq('join_code', 'PUBLIC')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      showScreen('configScreen');
      $('configScreen').innerHTML = '<h2>Verbindung fehlgeschlagen</h2><p>Die App konnte den gemeinsamen Bereich nicht laden. Bitte Supabase-Einstellungen prüfen.</p>';
      return;
    }

    household = data;
    if (!household) {
      showScreen('configScreen');
      $('configScreen').innerHTML = '<h2>Gemeinsamer Bereich fehlt</h2><p>In Supabase wurde noch kein PUBLIC-Bereich gefunden.</p>';
      return;
    }

    $('householdTitle').textContent = household.name || 'Klamottengeld';
    showScreen('appScreen');
    await loadAll();
  }

  async function loadAll() {
    const [{ data: s, error: se }, { data: p, error: pe }] = await Promise.all([
      client.from('budget_settings').select('*').eq('household_id', household.id),
      client
        .from('purchases')
        .select('*, purchase_items(*)')
        .eq('household_id', household.id)
        .order('purchase_date', { ascending: false })
        .order('created_at', { ascending: false })
    ]);

    if (se || pe) {
      console.error(se || pe);
      toast('Daten konnten nicht geladen werden.');
      return;
    }

    settings = s || [];
    purchases = p || [];
    render();
  }

  function render() {
    $('quarterLabel').textContent = `Q${selectedQuarter} ${selectedYear}`;
    renderBudgets();
    renderPurchases();
  }

  function budgetFor(category) {
    const s = settings.find((x) => x.category === category);
    if (!s) return { available: 0, spentSelected: 0, allowanceSelected: 0 };

    const startIdx = quarterIndex(s.start_year, s.start_quarter);
    const selIdx = quarterIndex(selectedYear, selectedQuarter);
    const quarters = selIdx - startIdx + 1;
    const allowance = quarters > 0
      ? Number(s.opening_balance) + quarters * Number(s.quarterly_budget)
      : Number(s.opening_balance);

    const end = quarterEnd(selectedYear, selectedQuarter);
    const start = quarterStart(selectedYear, selectedQuarter);
    let spentThrough = 0;
    let spentSelected = 0;

    purchases.forEach((p) => {
      (p.purchase_items || [])
        .filter((i) => i.category === category)
        .forEach((i) => {
          const familyShare = Number(i.amount) - Number(i.own_share || 0);
          if (p.purchase_date <= end) spentThrough += familyShare;
          if (p.purchase_date >= start && p.purchase_date <= end) spentSelected += familyShare;
        });
    });

    return {
      available: allowance - spentThrough,
      spentSelected,
      allowanceSelected: Number(s.quarterly_budget)
    };
  }

  function renderBudgets() {
    $('budgetCards').innerHTML = categories.map((c) => {
      const b = budgetFor(c.key);
      const cls = b.available < 0 ? 'negative' : 'positive';
      return `
        <div class="budget-card">
          <div class="name">${c.icon} ${c.name}</div>
          <div class="value ${cls}">${money(b.available)}</div>
          <div class="sub">In Q${selectedQuarter}: ${money(b.spentSelected)} genutzt · ${money(b.allowanceSelected)} neues Budget</div>
        </div>`;
    }).join('');
  }

  function renderPurchases() {
    const start = quarterStart(selectedYear, selectedQuarter);
    const end = quarterEnd(selectedYear, selectedQuarter);
    const list = purchases.filter((p) => p.purchase_date >= start && p.purchase_date <= end);

    if (!list.length) {
      $('purchaseList').innerHTML = '<div class="empty">In diesem Quartal gibt es noch keine Einkäufe.</div>';
      return;
    }

    $('purchaseList').innerHTML = list.map((p) => {
      const total = (p.purchase_items || []).reduce((a, i) => a + Number(i.amount), 0);
      const own = (p.purchase_items || []).reduce((a, i) => a + Number(i.own_share || 0), 0);
      const chips = (p.purchase_items || []).map((i) => `
        <span class="chip">${categoryName(i.category)} ${money(Number(i.amount) - Number(i.own_share || 0))}</span>`
      ).join('');

      return `
        <button class="purchase" data-purchase-id="${p.id}">
          <div class="purchase-top">
            <div>
              <div class="purchase-title">${escapeHtml(p.merchant || 'Einkauf')}</div>
              <div class="purchase-meta">${dateDE(p.purchase_date)}${p.invoice_number ? ` · ${escapeHtml(p.invoice_number)}` : ''}</div>
            </div>
            <div class="purchase-amount">${money(total)}</div>
          </div>
          <div class="chips">
            ${chips}
            ${own > 0 ? `<span class="chip">Eigenanteil ${money(own)}</span>` : ''}
          </div>
        </button>`;
    }).join('');

    document.querySelectorAll('[data-purchase-id]').forEach((el) => {
      el.addEventListener('click', () => openPurchase(el.dataset.purchaseId));
    });
  }

  $('prevQuarter').addEventListener('click', () => {
    selectedQuarter--;
    if (selectedQuarter < 1) {
      selectedQuarter = 4;
      selectedYear--;
    }
    render();
  });

  $('nextQuarter').addEventListener('click', () => {
    selectedQuarter++;
    if (selectedQuarter > 4) {
      selectedQuarter = 1;
      selectedYear++;
    }
    render();
  });

  function addItemRow(item = {}) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <label class="category">Kategorie
        <select class="item-category">
          ${categories.map((c) => `<option value="${c.key}" ${item.category === c.key ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
        </select>
      </label>
      <label>Betrag
        <input class="item-amount" type="number" min="0" step="0.01" inputmode="decimal" value="${item.amount ?? ''}" required />
      </label>
      <label>Eigenanteil Sohn
        <input class="item-own" type="number" min="0" step="0.01" inputmode="decimal" value="${item.own_share ?? 0}" required />
      </label>
      <button type="button" class="remove-item">Position entfernen</button>`;

    row.querySelector('.remove-item').addEventListener('click', () => {
      if ($('itemsContainer').children.length > 1) row.remove();
      else toast('Mindestens eine Position wird benötigt.');
    });

    $('itemsContainer').appendChild(row);
  }

  function newPurchase() {
    $('purchaseDialogTitle').textContent = 'Einkauf eintragen';
    $('purchaseId').value = '';
    $('purchaseDate').value = new Date().toISOString().slice(0, 10);
    $('merchant').value = '';
    $('invoiceNumber').value = '';
    $('notes').value = '';
    $('itemsContainer').innerHTML = '';
    addItemRow({ category: 'clothes', own_share: 0 });
    $('deletePurchaseBtn').classList.add('hidden');
    $('purchaseDialog').showModal();
  }

  function openPurchase(id) {
    const p = purchases.find((x) => x.id === id);
    if (!p) return;

    $('purchaseDialogTitle').textContent = 'Einkauf bearbeiten';
    $('purchaseId').value = p.id;
    $('purchaseDate').value = p.purchase_date;
    $('merchant').value = p.merchant || '';
    $('invoiceNumber').value = p.invoice_number || '';
    $('notes').value = p.notes || '';
    $('itemsContainer').innerHTML = '';
    (p.purchase_items || []).forEach(addItemRow);
    $('deletePurchaseBtn').classList.remove('hidden');
    $('purchaseDialog').showModal();
  }

  $('addPurchaseBtn').addEventListener('click', newPurchase);
  $('addItemBtn').addEventListener('click', () => addItemRow({ own_share: 0 }));
  document.querySelectorAll('[data-close-dialog]').forEach((b) => {
    b.addEventListener('click', () => $('purchaseDialog').close());
  });

  $('purchaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const rows = [...document.querySelectorAll('.item-row')];
    const items = rows.map((r) => ({
      category: r.querySelector('.item-category').value,
      amount: Number(r.querySelector('.item-amount').value),
      own_share: Number(r.querySelector('.item-own').value || 0)
    }));

    if (items.some((i) => i.amount < 0 || i.own_share < 0 || i.own_share > i.amount)) {
      toast('Bitte Beträge prüfen. Der Eigenanteil darf den Betrag nicht übersteigen.');
      return;
    }

    const payload = {
      household_id: household.id,
      purchase_date: $('purchaseDate').value,
      merchant: $('merchant').value.trim() || null,
      invoice_number: $('invoiceNumber').value.trim() || null,
      notes: $('notes').value.trim() || null,
      created_by: null
    };

    let purchaseId = $('purchaseId').value;

    if (purchaseId) {
      const updatePayload = { ...payload };
      delete updatePayload.created_by;
      const { error } = await client.from('purchases').update(updatePayload).eq('id', purchaseId);
      if (error) {
        console.error(error);
        toast(error.message);
        return;
      }

      const del = await client.from('purchase_items').delete().eq('purchase_id', purchaseId);
      if (del.error) {
        console.error(del.error);
        toast(del.error.message);
        return;
      }
    } else {
      const { data, error } = await client.from('purchases').insert(payload).select('id').single();
      if (error) {
        console.error(error);
        toast(error.message);
        return;
      }
      purchaseId = data.id;
    }

    const { error: itemError } = await client
      .from('purchase_items')
      .insert(items.map((i) => ({ ...i, purchase_id: purchaseId })));

    if (itemError) {
      console.error(itemError);
      toast(itemError.message);
      return;
    }

    $('purchaseDialog').close();
    toast('Gespeichert.');
    await loadAll();
  });

  $('deletePurchaseBtn').addEventListener('click', async () => {
    const id = $('purchaseId').value;
    if (!id || !confirm('Diesen Einkauf wirklich löschen?')) return;

    const { error } = await client.from('purchases').delete().eq('id', id);
    if (error) {
      console.error(error);
      toast(error.message);
      return;
    }

    $('purchaseDialog').close();
    toast('Einkauf gelöscht.');
    await loadAll();
  });

  init();
})();
