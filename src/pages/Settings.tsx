import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/context";
import { exportCsv, exportJson, exportXlsx, importCsvAsTransactions, importJsonFile } from "../lib/export";
import { connect, disconnect, getSyncConfig, pullState } from "../lib/sync";

export function Settings({ onLoadSample }: { onLoadSample: () => void }) {
  const { data, reset, importData, addTransaction } = useStore();
  const jsonInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [syncCfg, setSyncCfg] = useState(getSyncConfig());
  const [code, setCode] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setSyncCfg(getSyncConfig());
  }, []);

  async function handleConnect() {
    setSyncError(null);
    setSyncBusy(true);
    try {
      await connect(code);
      setSyncCfg(getSyncConfig());
      const remote = await pullState();
      if (remote) {
        importData({ ...data, ...remote });
      }
      setCode("");
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
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Синхронизация с Telegram-ботом</h3>
        <p className="mb-3 text-xs text-slate-500">
          Откройте <a className="text-blue-600" href="https://t.me/finance_kema_bot" target="_blank" rel="noreferrer">@finance_kema_bot</a>,
          отправьте <code>/start</code> и вставьте 6-значный код сюда. После этого расходы, доходы, долги и цели будут общими между сайтом и ботом.
        </p>
        {syncCfg ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-600">
              Подключено: <code className="rounded bg-slate-100 px-1 py-0.5">{syncCfg.linkCode}</code> &middot;{" "}
              <span className="text-slate-400">{new Date(syncCfg.connectedAt).toLocaleString("ru-RU")}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={handleRefresh} disabled={syncBusy}>
                {syncBusy ? "Обновляю..." : "Обновить сейчас"}
              </button>
              <button className="btn-danger" onClick={handleDisconnect}>
                Отключить
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
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
