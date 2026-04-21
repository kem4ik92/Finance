import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/context";
import { exportCsv, exportJson, exportXlsx, importCsvAsTransactions, importJsonFile } from "../lib/export";
import {
  connect,
  disconnect,
  getKnownWorkspaces,
  getSyncConfig,
  pullState,
  refreshWorkspaceMeta,
  removeKnownWorkspace,
  switchWorkspace,
  type SyncConfig,
} from "../lib/sync";

export function Settings({ onLoadSample }: { onLoadSample: () => void }) {
  const { data, reset, importData, addTransaction } = useStore();
  const jsonInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [syncCfg, setSyncCfg] = useState(getSyncConfig());
  const [wallets, setWallets] = useState<SyncConfig[]>(getKnownWorkspaces());
  const [code, setCode] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setSyncCfg(getSyncConfig());
    setWallets(getKnownWorkspaces());
    // Refresh names from backend in the background.
    getKnownWorkspaces().forEach((w) => {
      refreshWorkspaceMeta(w.workspaceId).then(() => setWallets(getKnownWorkspaces()));
    });
  }, []);

  async function handleConnect() {
    setSyncError(null);
    setSyncBusy(true);
    try {
      await connect(code);
      setSyncCfg(getSyncConfig());
      setWallets(getKnownWorkspaces());
      const remote = await pullState();
      if (remote) {
        importData({ ...data, ...remote });
      }
      setCode("");
      setShowAdd(false);
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncBusy(false);
    }
  }

  function handleDisconnect() {
    if (!confirm("Отключить синхронизацию? Данные останутся в этом браузере.")) return;
    disconnect();
    setSyncCfg(null);
  }

  async function handleRefresh() {
    setSyncBusy(true);
    try {
      const remote = await pullState();
      if (remote) importData({ ...data, ...remote });
      await Promise.all(wallets.map((w) => refreshWorkspaceMeta(w.workspaceId)));
      setWallets(getKnownWorkspaces());
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleSwitch(workspaceId: string) {
    setSyncError(null);
    setSyncBusy(true);
    try {
      const cfg = switchWorkspace(workspaceId);
      if (!cfg) throw new Error("Кошелёк не найден");
      setSyncCfg(getSyncConfig());
      setWallets(getKnownWorkspaces());
      const remote = await pullState();
      if (remote) importData({ ...data, ...remote });
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncBusy(false);
    }
  }

  function handleForget(workspaceId: string, label: string) {
    if (!confirm(`Убрать «${label}» из списка кошельков? Данные на сервере не удалятся — ты сможешь вернуться по коду.`)) return;
    removeKnownWorkspace(workspaceId);
    setSyncCfg(getSyncConfig());
    setWallets(getKnownWorkspaces());
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Кошельки и синхронизация</h3>
        <p className="mb-3 text-xs text-slate-500">
          Открой <a className="text-blue-600" href="https://t.me/finance_kema_bot" target="_blank" rel="noreferrer">@finance_kema_bot</a>,
          нажми <code>/start</code> и <b>«👛 Кошельки»</b> — там можно создать несколько кошельков (личный, семейный, бизнес) и приглашать других людей. Здесь ты можешь подключить любой из них по 6-значному коду и переключаться между ними.
        </p>

        {wallets.length > 0 && (
          <ul className="mb-3 space-y-2">
            {wallets.map((w) => {
              const isCurrent = syncCfg?.workspaceId === w.workspaceId;
              const label = w.name || "Без имени";
              return (
                <li
                  key={w.workspaceId}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${
                    isCurrent ? "border-blue-400 bg-blue-50" : "border-slate-200"
                  }`}
                >
                  <div>
                    <div className="font-medium text-slate-800">
                      {isCurrent && <span className="mr-1">✅</span>}
                      {label}
                    </div>
                    <div className="text-xs text-slate-500">
                      код <code className="rounded bg-slate-100 px-1 py-0.5">{w.linkCode}</code>
                      {" · "}
                      <span className="text-slate-400">
                        {new Date(w.connectedAt).toLocaleDateString("ru-RU")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!isCurrent && (
                      <button
                        className="btn-secondary"
                        onClick={() => handleSwitch(w.workspaceId)}
                        disabled={syncBusy}
                      >
                        Переключиться
                      </button>
                    )}
                    <button
                      className="btn-ghost text-xs text-slate-500"
                      onClick={() => handleForget(w.workspaceId, label)}
                      disabled={syncBusy}
                    >
                      Убрать
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {syncCfg ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={handleRefresh} disabled={syncBusy}>
              {syncBusy ? "Обновляю..." : "Обновить сейчас"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowAdd((v) => !v)}
              disabled={syncBusy}
            >
              {showAdd ? "← Отмена" : "➕ Добавить кошелёк"}
            </button>
            <button className="btn-danger" onClick={handleDisconnect} disabled={syncBusy}>
              Отключить активный
            </button>
          </div>
        ) : (
          <p className="mb-2 text-xs text-slate-500">
            Пока нет подключённых кошельков. Введи код из бота, чтобы начать.
          </p>
        )}

        {(showAdd || !syncCfg) && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Код из бота</label>
              <input
                className="input w-40"
                placeholder="ABC123"
                value={code}
                maxLength={8}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={syncBusy}
              />
            </div>
            <button className="btn-primary" onClick={handleConnect} disabled={syncBusy || !code}>
              {syncBusy ? "Подключаю..." : "Подключить"}
            </button>
          </div>
        )}

        {syncError && <p className="mt-2 text-xs text-rose-600">{syncError}</p>}
      </div>

      <div className="card">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Экспорт данных</h3>
        <p className="mb-3 text-xs text-slate-500">
          Сохраните таблицу всех транзакций в CSV или Excel, либо сделайте полную резервную копию (JSON).
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => exportCsv(data)}>
            Скачать CSV
          </button>
          <button className="btn-primary" onClick={() => exportXlsx(data)}>
            Скачать Excel
          </button>
          <button className="btn-secondary" onClick={() => exportJson(data)}>
            Резервная копия (JSON)
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Импорт</h3>
        <p className="mb-3 text-xs text-slate-500">
          Восстановите данные из резервной копии или импортируйте транзакции из CSV (формат экспорта этой программы).
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => jsonInput.current?.click()}>
            Загрузить JSON
          </button>
          <button className="btn-secondary" onClick={() => csvInput.current?.click()}>
            Импорт транзакций из CSV
          </button>
          <input
            ref={jsonInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const d = await importJsonFile(f);
                if (confirm("Заменить текущие данные данными из файла?")) importData(d);
              } catch (err) {
                alert("Не удалось загрузить файл: " + (err as Error).message);
              } finally {
                e.target.value = "";
              }
            }}
          />
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const txs = await importCsvAsTransactions(f, data);
                if (txs.length === 0) {
                  alert("В файле не найдено подходящих транзакций.");
                } else if (confirm(`Добавить ${txs.length} транзакций?`)) {
                  txs.forEach((t) => {
                    const { ...rest } = t;
                    addTransaction(rest);
                  });
                }
              } catch (err) {
                alert("Не удалось импортировать: " + (err as Error).message);
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>
      </div>

      <div className="card">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Демо-данные</h3>
        <p className="mb-3 text-xs text-slate-500">
          Хотите посмотреть, как выглядят графики? Загрузим примерные транзакции за последние 3 месяца.
        </p>
        <button className="btn-secondary" onClick={onLoadSample}>
          Загрузить демо-данные
        </button>
      </div>

      <div className="card border-rose-200">
        <h3 className="mb-1 text-sm font-semibold text-rose-700">Опасная зона</h3>
        <p className="mb-3 text-xs text-slate-500">
          Полное удаление всех данных: транзакции, счета, категории, цели и напоминания.
        </p>
        <button
          className="btn-danger"
          onClick={() => {
            if (
              confirm(
                "Вы уверены? Все данные будут удалены. Сделайте резервную копию перед этим.",
              )
            )
              reset();
          }}
        >
          Сбросить все данные
        </button>
      </div>

      <div className="card">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">О программе</h3>
        <p className="text-xs text-slate-500">
          Manat — приложение для личного финансового учёта. Валюта: туркменский манат (TMT). Данные
          хранятся только в вашем браузере. Никаких серверов и регистрации.
        </p>
      </div>
    </div>
  );
}
