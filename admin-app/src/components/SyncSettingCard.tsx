import React, { useState, useEffect } from 'react';
import { Clock, Info, Play, RefreshCw, Timer, Save } from 'lucide-react';
import { useSyncLogs } from '@golf-core/hooks/useSyncLogs';
import type { SyncSetting, AutosyncSettings } from '@golf-core/types';

type SyncEndpointKey = keyof Omit<AutosyncSettings, 'activeTournamentId' | 'activeYear' | 'activeRound' | 'tournamentDetectionMode' | 'autoDetectedTournamentName' | 'lastAutoDetection'>;

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const matchCronField = (field: string, value: number): boolean => {
  if (field === '*') return true;
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const start = range === '*' ? 0 : Number(range);
    return value >= start && (value - start) % Number(step) === 0;
  }
  if (field.includes(',')) return field.split(',').map(Number).includes(value);
  if (field.includes('-')) { const [a, b] = field.split('-').map(Number); return value >= a && value <= b; }
  return Number(field) === value;
};

const getNextRunTime = (cron: string, lastRun?: Date): Date | null => {
  const now = new Date();
  if (cron.startsWith('every ')) {
    const parts = cron.split(' ');
    const isNumberFirst = !isNaN(Number(parts[1]));
    const n = isNumberFirst ? Number(parts[1]) : 1;
    const unit = isNumberFirst ? (parts[2] || 'minutes') : parts[1];
    const timePart = parts.find(p => /^\d{1,2}:\d{2}$/.test(p));
    const dayPart = parts.find(p => DAYS_OF_WEEK.includes(p));
    const [th, tm] = (timePart || '00:00').split(':').map(Number);

    if ((unit === 'week' || unit === 'weeks') && dayPart) {
      const targetDow = DAYS_OF_WEEK.indexOf(dayPart);
      if (lastRun) {
        const next = new Date(lastRun);
        next.setDate(next.getDate() + n * 7);
        next.setHours(th, tm, 0, 0);
        const diff = (targetDow - next.getDay() + 7) % 7;
        if (diff > 0) next.setDate(next.getDate() + diff);
        while (next <= now) next.setDate(next.getDate() + n * 7);
        return next;
      } else {
        const next = new Date(now);
        const daysUntil = (targetDow - next.getDay() + 7) % 7;
        if (daysUntil === 0) { next.setHours(th, tm, 0, 0); if (next <= now) next.setDate(next.getDate() + 7); }
        else { next.setDate(next.getDate() + daysUntil); next.setHours(th, tm, 0, 0); }
        return next;
      }
    }

    const addInterval = (d: Date): Date => {
      const r = new Date(d);
      switch (unit) {
        case 'minute': case 'minutes': r.setMinutes(r.getMinutes() + n, 0, 0); break;
        case 'hour': case 'hours': r.setHours(r.getHours() + n, 0, 0, 0); break;
        case 'day': case 'days': r.setDate(r.getDate() + n); r.setHours(th, tm, 0, 0); break;
        case 'week': case 'weeks': r.setDate(r.getDate() + n * 7); r.setHours(th, tm, 0, 0); break;
        case 'month': case 'months': r.setMonth(r.getMonth() + n); r.setHours(th, tm, 0, 0); break;
      }
      return r;
    };
    let next = addInterval(lastRun ?? now);
    while (next <= now) next = addInterval(next);
    return next;
  }

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minField, hourField, domField, monthField, dowField] = parts;
  const base = new Date(now);
  base.setSeconds(0, 0);
  base.setMinutes(base.getMinutes() + 1);
  for (let dayOffset = 0; dayOffset <= 366; dayOffset++) {
    const day = new Date(base);
    day.setDate(base.getDate() + dayOffset);
    if (!matchCronField(monthField, day.getMonth() + 1)) continue;
    if (!matchCronField(domField, day.getDate())) continue;
    if (!matchCronField(dowField, day.getDay())) continue;
    const startHour = dayOffset === 0 ? base.getHours() : 0;
    for (let h = startHour; h < 24; h++) {
      if (!matchCronField(hourField, h)) continue;
      const startMin = dayOffset === 0 && h === base.getHours() ? base.getMinutes() : 0;
      for (let m = startMin; m < 60; m++) {
        if (!matchCronField(minField, m)) continue;
        day.setHours(h, m, 0, 0);
        if (day > now) return new Date(day);
      }
    }
  }
  return null;
};

const formatNextRun = (date: Date | null): string => {
  if (!date) return 'Unknown';
  const diffMins = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMins < 1) return 'Imminent';
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffMins < 1440) { const h = Math.floor(diffMins / 60); const m = diffMins % 60; return `in ${h}h${m > 0 ? ` ${m}m` : ''}`; }
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

interface SyncSettingCardProps {
  settingKey: SyncEndpointKey;
  label: string;
  val: SyncSetting;
  updateEndpoint: (endpoint: SyncEndpointKey, params: Partial<SyncSetting>) => void;
  onRunNow?: () => void;
  isRunning?: boolean;
  onRunAll?: () => void;
  isRunningAll?: boolean;
}

const SyncSettingCard: React.FC<SyncSettingCardProps> = ({
  settingKey, label, val, updateEndpoint, onRunNow, isRunning = false, onRunAll, isRunningAll = false,
}) => {
  const { latestLog, loading: logLoading } = useSyncLogs(settingKey);
  const [showLogDetails, setShowLogDetails] = useState(false);
  const [localCron, setLocalCron] = useState(val.cron);
  const isDirty = localCron !== val.cron;

  useEffect(() => { setLocalCron(val.cron); }, [val.cron]);

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return 'Never';
    try {
      if (timestamp.toDate) return timestamp.toDate().toLocaleString();
      if (timestamp.seconds) return new Date(timestamp.seconds * 1000).toLocaleString();
      if (timestamp instanceof Date) return timestamp.toLocaleString();
      return new Date(timestamp).toLocaleString();
    } catch { return 'Unknown'; }
  };

  const toDate = (timestamp: any): Date | undefined => {
    if (!timestamp) return undefined;
    try {
      if (timestamp.toDate) return timestamp.toDate();
      if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
      if (timestamp instanceof Date) return timestamp;
      return new Date(timestamp);
    } catch { return undefined; }
  };

  const lastRunDate = toDate(latestLog?.timestamp);
  const nextRunDate = val.enabled ? getNextRunTime(localCron, lastRunDate) : null;

  const extractTime = (cron: string) => cron.split(' ').find(p => /^\d{1,2}:\d{2}$/.test(p)) || '00:00';
  const extractDayOfWeek = (cron: string) => cron.split(' ').find(p => DAYS_OF_WEEK.includes(p)) || 'Monday';

  const handleTimeChange = (timeValue: string) => {
    const parts = localCron.split(' ');
    const isNumberFirst = !isNaN(Number(parts[1]));
    const n = isNumberFirst ? parts[1] : '1';
    const unit = isNumberFirst ? parts[2] : parts[1];
    if (unit === 'week' || unit === 'weeks') {
      setLocalCron(`every ${n} ${unit} ${extractDayOfWeek(localCron)} ${timeValue}`);
    } else if (isNumberFirst) {
      setLocalCron(`every ${n} ${unit} ${timeValue}`);
    } else {
      setLocalCron(`every ${parts[1]} ${timeValue}`);
    }
  };

  const handleDayChange = (day: string) => {
    const parts = localCron.split(' ');
    const n = !isNaN(Number(parts[1])) ? parts[1] : '1';
    setLocalCron(`every ${n} weeks ${day} ${extractTime(localCron)}`);
  };

  return (
    <div className="bg-white text-gray-900 border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-center mb-4">
        <span className="font-bold text-gray-800 text-lg">{label}</span>
        <div className="flex items-center space-x-4">
          {onRunAll && (
            <button
              onClick={onRunAll}
              disabled={isRunningAll || isRunning}
              className={`flex items-center px-3 py-1 text-sm font-medium rounded-md transition-colors ${isRunningAll ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200'}`}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isRunningAll ? 'animate-spin' : ''}`} />
              {isRunningAll ? 'Syncing...' : 'Sync All'}
            </button>
          )}
          {onRunNow && (
            <button
              onClick={onRunNow}
              disabled={isRunning || isRunningAll}
              className={`flex items-center px-3 py-1 text-sm font-medium rounded-md transition-colors ${isRunning ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'}`}
            >
              <Play className={`w-3 h-3 mr-1 ${isRunning ? 'animate-pulse' : ''}`} />
              {isRunning ? 'Running...' : 'Run Now'}
            </button>
          )}
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={val.enabled}
              onChange={(e) => updateEndpoint(settingKey, { enabled: e.target.checked })}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>
      </div>

      <div className="flex flex-col space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-gray-700 w-16 md:w-24">Every:</span>
          {localCron.startsWith('every ') ? (
            <>
              <select
                className="p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 bg-white text-black shadow-sm"
                value={!isNaN(Number(localCron.split(' ')[1])) ? localCron.split(' ')[1] : '1'}
                onChange={(e) => {
                  const parts = localCron.split(' ');
                  const isNumberFirst = !isNaN(Number(parts[1]));
                  const currentUnit = isNumberFirst ? (parts[2] || 'minutes') : parts[1];
                  const existingTime = extractTime(localCron);
                  let timeSuffix = '';
                  if (['week', 'weeks'].includes(currentUnit)) timeSuffix = ` ${extractDayOfWeek(localCron)} ${existingTime}`;
                  else if (['day', 'days', 'month', 'months'].includes(currentUnit)) timeSuffix = ` ${existingTime}`;
                  setLocalCron(`every ${e.target.value} ${currentUnit}${timeSuffix}`);
                }}
              >
                {[1, 2, 3, 4, 5, 10, 15, 20, 30, 45].map(num => <option key={num} value={num}>{num}</option>)}
              </select>
              <select
                className="p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 bg-white text-black shadow-sm flex-1"
                value={!isNaN(Number(localCron.split(' ')[1])) ? (localCron.split(' ')[2] || 'minutes') : localCron.split(' ')[1]}
                onChange={(e) => {
                  const parts = localCron.split(' ');
                  const isNumberFirst = !isNaN(Number(parts[1]));
                  const currentVal = isNumberFirst ? parts[1] : '1';
                  const newUnit = e.target.value;
                  const existingTime = extractTime(localCron);
                  let timeSuffix = '';
                  if (['week', 'weeks'].includes(newUnit)) {
                    const existingDay = ['week', 'weeks'].includes(parts[2] || '') ? extractDayOfWeek(localCron) : 'Monday';
                    timeSuffix = ` ${existingDay} ${existingTime}`;
                  } else if (['day', 'days', 'month', 'months'].includes(newUnit)) {
                    timeSuffix = ` ${existingTime}`;
                  }
                  setLocalCron(`every ${currentVal} ${newUnit}${timeSuffix}`);
                }}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </select>
            </>
          ) : (
            <input
              type="text"
              value={localCron}
              onChange={(e) => setLocalCron(e.target.value)}
              className="flex-1 p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 bg-white text-black shadow-sm"
              placeholder="e.g. 0 0 * * 1"
            />
          )}
          <button
            className="text-xs text-green-600 hover:text-green-800 underline ml-2"
            onClick={() => {
              if (localCron.startsWith('every ')) { updateEndpoint(settingKey, { cron: '0 0 * * *' }); }
              else { updateEndpoint(settingKey, { cron: 'every 5 minutes' }); }
            }}
          >
            {localCron.startsWith('every ') ? 'Advanced' : 'Simple'}
          </button>
        </div>

        {localCron.startsWith('every ') && (() => {
          const cronParts = localCron.split(' ');
          const cronUnit = !isNaN(Number(cronParts[1])) ? cronParts[2] : cronParts[1];
          const isWeekly = ['week', 'weeks'].includes(cronUnit);
          if (!['day', 'days', 'week', 'weeks', 'month', 'months'].includes(cronUnit)) return null;
          return (
            <div className="flex items-center space-x-3 pl-16 md:pl-24 mt-2 flex-wrap gap-y-2">
              {isWeekly && (
                <>
                  <span className="text-sm text-gray-600 font-medium">On:</span>
                  <select
                    className="p-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 bg-white text-black shadow-sm"
                    value={extractDayOfWeek(localCron)}
                    onChange={(e) => handleDayChange(e.target.value)}
                  >
                    {DAYS_OF_WEEK.map(day => <option key={day} value={day}>{day}</option>)}
                  </select>
                </>
              )}
              <span className="text-sm text-gray-600 font-medium">{isWeekly ? 'at' : 'At time:'}</span>
              <input
                type="time"
                value={extractTime(localCron)}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="p-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 bg-white text-black shadow-sm"
              />
            </div>
          );
        })()}

        {isDirty && (
          <div className="flex justify-end pt-1">
            <button
              onClick={() => updateEndpoint(settingKey, { cron: localCron })}
              className="flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              <Save className="w-3 h-3 mr-1.5" />Save
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-gray-500 bg-white rounded border border-gray-100 p-2 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Clock className="w-3 h-3 mr-1" />
            <span>Last run: <span className="font-medium text-gray-700">{logLoading ? 'Loading...' : formatTimestamp(latestLog?.timestamp)}</span></span>
          </div>
          {latestLog && (
            <button onClick={() => setShowLogDetails(!showLogDetails)} className="flex items-center text-green-600 hover:text-green-800 font-medium cursor-pointer">
              <Info className="w-3 h-3 mr-1" />
              {showLogDetails ? 'Hide Log' : 'View Log'}
            </button>
          )}
        </div>
        <div className="flex items-center">
          <Timer className="w-3 h-3 mr-1" />
          {val.enabled
            ? <span>Next run: <span className="font-medium text-gray-700">{formatNextRun(nextRunDate)}</span></span>
            : <span className="font-medium text-gray-400">Inactive</span>}
        </div>
      </div>

      {showLogDetails && latestLog && (
        <div className={`mt-2 p-2 rounded text-xs border ${latestLog.status === 'success' ? 'bg-green-50 border-green-200 text-green-800' : latestLog.status === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
          <div className="flex justify-between font-bold mb-1">
            <span className="capitalize">Status: {latestLog.status}</span>
            {latestLog.tournamentId && <span>Tourn: {latestLog.tournamentId}{latestLog.roundId ? ` | R${latestLog.roundId}` : ''}</span>}
          </div>
          <p className="font-mono mt-1 whitespace-pre-wrap">{latestLog.message}</p>
          {latestLog.details && (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold opacity-70 hover:opacity-100">Full details</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all opacity-80">{JSON.stringify(latestLog.details, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncSettingCard;
