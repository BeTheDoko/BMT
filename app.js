(() => {
  'use strict';

  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const STORAGE_KEY = `bmt.daily-plan.v1:${dateKey}`;
  const $ = (selector) => document.querySelector(selector);
  const els = {
    todayDate: $('#today-date'), headingDate: $('#heading-date'), clock: $('#live-clock'),
    progressPercent: $('#progress-percent'), progressCount: $('#progress-count'), progressFill: $('#progress-fill'),
    taskCount: $('#task-count'), plannedTime: $('#planned-time'), timeFoot: $('#time-foot'), listCount: $('#list-count'),
    scheduleStatus: $('#schedule-status'), activeState: $('#active-state-label'), activeNumber: $('#active-task-number'),
    activeName: $('#active-task-name'), activeNote: $('#active-task-note'), activeTime: $('#active-time-range'),
    timerLabel: $('#timer-label'), timer: $('#timer-display'), taskList: $('#task-list'), emptyState: $('#empty-state'),
    form: $('#task-form'), formTitle: $('#composer-heading'), taskName: $('#task-name'), hours: $('#duration-hours'),
    minutes: $('#duration-minutes'), notes: $('#task-notes'), editId: $('#edit-task-id'), submitTask: $('#submit-task'),
    cancelEdit: $('#cancel-edit'), formError: $('#form-error'), start: $('#start-button'), resume: $('#resume-button'),
    pause: $('#pause-button'), complete: $('#complete-button'), skip: $('#skip-button'), extend: $('#extend-button'),
    stop: $('#stop-button'), reset: $('#reset-button'), hint: $('#schedule-hint'), composer: $('#task-composer')
  };

  function freshState() {
    return { tasks: [], schedule: { status: 'idle', startedAt: null, currentTaskId: null, segmentStartedAt: null, segmentDurationSeconds: null, pausedRemainingSeconds: null } };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.tasks) || !parsed.schedule) return freshState();
      const tasks = parsed.tasks.filter((task) => task && typeof task.id === 'string' && typeof task.name === 'string' && Number.isFinite(task.durationSeconds) && task.durationSeconds > 0)
        .map((task) => ({ status: 'pending', notes: '', ...task }));
      return { tasks, schedule: { ...freshState().schedule, ...parsed.schedule } };
    } catch (error) {
      console.warn('Could not read today’s saved plan.', error);
      return freshState();
    }
  }

  let state = loadState();
  let lastClockMinute = '';

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { showHint('This browser could not save the plan. Check its local storage settings.'); console.error(error); }
  }

  function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function formatDuration(seconds) {
    const mins = Math.max(0, Math.round(seconds / 60));
    const hours = Math.floor(mins / 60);
    const remainder = mins % 60;
    if (hours && remainder) return `${hours}h ${remainder}m`;
    if (hours) return `${hours}h`;
    return `${remainder}m`;
  }

  function formatClock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatCountdown(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function currentTask() { return state.tasks.find((task) => task.id === state.schedule.currentTaskId) || null; }
  function pendingTask(afterTaskId = null) {
    const currentIndex = state.tasks.findIndex((task) => task.id === afterTaskId);
    const ordered = currentIndex < 0
      ? state.tasks
      : [...state.tasks.slice(currentIndex + 1), ...state.tasks.slice(0, currentIndex)];
    return ordered.find((task) => task.status === 'pending') || null;
  }

  function nextTaskAfter(now) {
    const next = pendingTask();
    if (!next) {
      state.schedule.status = 'completed';
      state.schedule.currentTaskId = null;
      state.schedule.segmentStartedAt = null;
      state.schedule.segmentDurationSeconds = null;
      state.schedule.pausedRemainingSeconds = null;
      return null;
    }
    next.status = 'active';
    next.startedAt = now;
    state.schedule.currentTaskId = next.id;
    state.schedule.segmentStartedAt = now;
    state.schedule.segmentDurationSeconds = next.durationSeconds;
    state.schedule.pausedRemainingSeconds = null;
    return next;
  }

  // A persisted absolute segment deadline lets the page catch up accurately after a refresh.
  function reconcileTimer(now) {
    if (state.schedule.status !== 'running') return false;
    let changed = false;
    let safety = state.tasks.length + 1;
    while (state.schedule.status === 'running' && safety-- > 0) {
      const task = currentTask();
      if (!task) {
        state.schedule.status = 'completed';
        changed = true;
        break;
      }
      const started = Number(state.schedule.segmentStartedAt);
      const duration = Number(state.schedule.segmentDurationSeconds);
      if (!Number.isFinite(started) || !Number.isFinite(duration)) {
        state.schedule.status = 'paused';
        state.schedule.pausedRemainingSeconds = task.durationSeconds;
        changed = true;
        break;
      }
      const deadline = started + duration * 1000;
      if (now < deadline) break;
      task.status = 'time_expired';
      task.timeExpiredAt = deadline;
      task.finishedAt = deadline;
      changed = true;
      const next = pendingTask(state.schedule.currentTaskId);
      if (!next) {
        state.schedule.status = 'completed';
        state.schedule.currentTaskId = null;
        state.schedule.segmentStartedAt = null;
        state.schedule.segmentDurationSeconds = null;
        state.schedule.pausedRemainingSeconds = null;
        break;
      }
      next.status = 'active';
      next.startedAt = deadline;
      state.schedule.currentTaskId = next.id;
      state.schedule.segmentStartedAt = deadline;
      state.schedule.segmentDurationSeconds = next.durationSeconds;
      state.schedule.pausedRemainingSeconds = null;
    }
    if (changed) saveState();
    return changed;
  }

  function scheduleProjection(now) {
    const result = new Map();
    if (!['running', 'paused'].includes(state.schedule.status)) return result;
    const active = currentTask();
    if (!active) return result;
    const activeStart = state.schedule.status === 'running' ? Number(state.schedule.segmentStartedAt) : now;
    const activeDuration = state.schedule.status === 'running'
      ? Number(state.schedule.segmentDurationSeconds)
      : Number(state.schedule.pausedRemainingSeconds ?? active.durationSeconds);
    let cursor = activeStart + activeDuration * 1000;
    result.set(active.id, { start: activeStart, end: cursor });
    const activeIndex = state.tasks.indexOf(active);
    const queue = [...state.tasks.slice(activeIndex + 1), ...state.tasks.slice(0, activeIndex)];
    for (const task of queue) {
      if (task.status !== 'pending') continue;
      result.set(task.id, { start: cursor, end: cursor + task.durationSeconds * 1000 });
      cursor += task.durationSeconds * 1000;
    }
    return result;
  }

  function dateLabel() {
    return today.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function statusText(status) {
    return ({ pending: 'Pending', active: 'In progress', completed: 'Completed', skipped: 'Skipped', time_expired: 'Time expired' })[status] || 'Pending';
  }

  function showHint(message) { els.hint.textContent = message; }

  function setStatusPill(status) {
    const labels = { idle: 'Not started', running: 'In progress', paused: 'Paused', completed: 'Schedule ended', stopped: 'Stopped' };
    els.scheduleStatus.className = `status-pill status-${status === 'running' ? 'running' : status === 'paused' ? 'paused' : status === 'completed' ? 'done' : status === 'stopped' ? 'stopped' : 'idle'}`;
    els.scheduleStatus.innerHTML = `<span class="status-dot"></span>${labels[status] || 'Not started'}`;
  }

  function renderTaskList(projection) {
    els.taskList.innerHTML = '';
    els.emptyState.classList.toggle('hidden', state.tasks.length > 0);
    if (!state.tasks.length) return;
    for (const [index, task] of state.tasks.entries()) {
      const timing = projection.get(task.id);
      const timeText = timing ? `${formatClock(timing.start)} – ${formatClock(timing.end)}` : '';
      const checked = task.status === 'completed' ? 'checked' : '';
      const note = task.notes ? `<div class="task-note">${escapeHtml(task.notes)}</div>` : '';
      const restoreAction = ['time_expired', 'skipped'].includes(task.status)
        ? `<button class="row-action" type="button" title="Mark unfinished" aria-label="Mark ${escapeHtml(task.name)} unfinished" data-action="restore">↺</button>` : '';
      const row = document.createElement('article');
      row.className = `task-row${task.status === 'completed' ? ' is-completed' : ''}${task.status === 'active' ? ' is-active' : ''}`;
      row.dataset.taskId = task.id;
      row.innerHTML = `
        <input class="task-check" type="checkbox" aria-label="Mark ${escapeHtml(task.name)} complete or unfinished" data-action="complete" ${checked} />
        <div class="task-main"><div class="task-title-line"><span class="task-title">${escapeHtml(task.name)}</span>${task.status === 'active' ? '<span class="row-status active">ACTIVE</span>' : task.status === 'time_expired' ? '<span class="row-status expired">TIME EXPIRED</span>' : task.status === 'skipped' ? '<span class="row-status skipped">SKIPPED</span>' : ''}</div>${note}</div>
        <div class="task-meta"><span class="task-time">${escapeHtml(timeText)}</span><span class="task-duration">${formatDuration(task.durationSeconds)}</span><div class="task-actions">
          <button class="row-action" type="button" title="Move up" aria-label="Move ${escapeHtml(task.name)} up" data-action="up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="row-action" type="button" title="Move down" aria-label="Move ${escapeHtml(task.name)} down" data-action="down" ${index === state.tasks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="row-action" type="button" title="Edit task" aria-label="Edit ${escapeHtml(task.name)}" data-action="edit">✎</button>
          ${restoreAction}
          <button class="row-action" type="button" title="Delete task" aria-label="Delete ${escapeHtml(task.name)}" data-action="delete">×</button>
        </div></div>`;
      els.taskList.append(row);
    }
  }

  function render(now = Date.now()) {
    els.todayDate.textContent = dateLabel();
    els.headingDate.textContent = dateLabel();
    const minuteKey = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (minuteKey !== lastClockMinute) { els.clock.textContent = minuteKey; lastClockMinute = minuteKey; }

    const total = state.tasks.length;
    const done = state.tasks.filter((task) => task.status === 'completed').length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const minutes = state.tasks.reduce((sum, task) => sum + task.durationSeconds, 0) / 60;
    els.progressPercent.textContent = `${percent}%`;
    els.progressCount.textContent = `${done} of ${total} task${total === 1 ? '' : 's'}`;
    els.progressFill.style.width = `${percent}%`;
    els.taskCount.textContent = total;
    els.listCount.textContent = total;
    els.plannedTime.textContent = formatDuration(minutes * 60);
    els.timeFoot.textContent = total ? `${formatDuration(minutes * 60)} planned across your day` : 'Your time, intentionally spent';

    const schedule = state.schedule;
    const active = currentTask();
    setStatusPill(schedule.status);
    const projection = scheduleProjection(now);
    const inFlight = ['running', 'paused'].includes(schedule.status) && active;
    if (inFlight) {
      const timing = projection.get(active.id);
      const remaining = schedule.status === 'running'
        ? (Number(schedule.segmentStartedAt) + Number(schedule.segmentDurationSeconds) * 1000 - now) / 1000
        : Number(schedule.pausedRemainingSeconds ?? active.durationSeconds);
      els.activeState.textContent = schedule.status === 'paused' ? 'PAUSED · READY TO RESUME' : 'CURRENTLY IN FOCUS';
      els.activeName.textContent = active.name;
      els.activeNote.textContent = active.notes || (schedule.status === 'paused' ? 'Your place is saved. Resume when you’re ready.' : 'One task at a time. You’re right where you need to be.');
      els.activeNumber.textContent = `${String(state.tasks.indexOf(active) + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      els.timerLabel.textContent = remaining < 0 ? 'TIME EXPIRED' : 'TIME LEFT';
      els.timer.textContent = formatCountdown(Math.max(0, remaining));
      els.timer.classList.toggle('timer-expired', remaining <= 0);
      els.activeTime.textContent = timing ? `${formatClock(timing.start)} – ${formatClock(timing.end)}${schedule.status === 'paused' ? ' · recalculated on resume' : ''}` : 'Your timing will update as you go.';
      showHint(remaining < 0 ? 'Time is up for this block. Confirm it complete, or skip it to continue.' : schedule.status === 'paused' ? 'Paused time is saved. Your following task times recalculate when you resume.' : 'The timer advances the plan, but only you can mark a task complete.');
    } else if (schedule.status === 'completed') {
      const expiredCount = state.tasks.filter((task) => task.status === 'time_expired').length;
      els.activeState.textContent = 'SCHEDULE ENDED';
      els.activeName.textContent = expiredCount ? 'Your scheduled time is up.' : 'Today’s schedule has ended.';
      els.activeNote.textContent = expiredCount
        ? `${expiredCount} task${expiredCount === 1 ? '' : 's'} expired without a completion mark. Review your list.`
        : 'Review completed and skipped tasks from today.';
      els.activeNumber.textContent = `${String(done).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      els.timerLabel.textContent = 'PLAN STATUS'; els.timer.textContent = 'Done'; els.timer.classList.remove('timer-expired');
      els.activeTime.textContent = 'Your tasks and their outcomes are still here.';
      showHint('You can review your list or reset today’s run when you’re ready.');
    } else if (schedule.status === 'stopped') {
      els.activeState.textContent = 'SCHEDULE STOPPED';
      els.activeName.textContent = 'Your plan is saved for today.';
      els.activeNote.textContent = 'Reset the run to start over with the same task list.';
      els.activeNumber.textContent = `${String(done).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      els.timerLabel.textContent = 'ON YOUR LIST'; els.timer.textContent = String(total); els.timer.classList.remove('timer-expired');
      els.activeTime.textContent = 'The schedule is stopped; task details are unchanged.';
      showHint('Reset the schedule to begin again. Your task list stays in place.');
    } else {
      els.activeState.textContent = total ? 'READY WHEN YOU ARE' : 'START WITH ONE TASK';
      els.activeName.textContent = total ? (pendingTask()?.name || 'Your list is ready.') : 'Your next task will show up here';
      els.activeNote.textContent = total ? 'Start when you’re ready, and times will be calculated from that moment.' : 'Add a task and choose when you want to begin.';
      els.activeNumber.textContent = total ? `${String(state.tasks.findIndex((task) => task.status === 'pending') + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '—';
      els.timerLabel.textContent = 'TIME LEFT'; els.timer.textContent = '--:--'; els.timer.classList.remove('timer-expired');
      els.activeTime.textContent = total ? 'Start your schedule to see the day take shape.' : 'Start your schedule to see the day take shape.';
      showHint(total ? 'Your plan is saved in this browser. Start the schedule when you are ready.' : 'The timer keeps its place if you refresh this page.');
    }

    const idle = schedule.status === 'idle';
    const canRun = idle && Boolean(pendingTask());
    els.start.classList.toggle('hidden', !idle);
    els.start.disabled = !canRun;
    els.resume.classList.toggle('hidden', schedule.status !== 'paused');
    els.pause.classList.toggle('hidden', schedule.status !== 'running');
    els.complete.classList.toggle('hidden', !inFlight);
    els.skip.classList.toggle('hidden', !inFlight);
    els.extend.classList.toggle('hidden', !inFlight);
    els.stop.classList.toggle('hidden', !['running', 'paused'].includes(schedule.status));
    els.reset.disabled = !total && schedule.status === 'idle';
    renderTaskList(projection);
  }

  function resetForm() {
    els.form.reset();
    els.hours.value = '0'; els.minutes.value = '30'; els.editId.value = '';
    els.formTitle.textContent = 'Add a task';
    els.submitTask.innerHTML = '<span aria-hidden="true">＋</span>Add to my day';
    els.cancelEdit.classList.add('hidden');
    els.formError.textContent = '';
  }

  function scrollToComposer() { els.composer.scrollIntoView({ behavior: 'smooth', block: 'start' }); els.taskName.focus({ preventScroll: true }); }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = els.taskName.value.trim();
    const hours = Number(els.hours.value);
    const minutes = Number(els.minutes.value);
    const note = els.notes.value.trim();
    if (!name) { els.formError.textContent = 'Give this task a name first.'; els.taskName.focus(); return; }
    if (!Number.isInteger(hours) || hours < 0 || hours > 99 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) { els.formError.textContent = 'Enter hours from 0–99 and minutes from 0–59.'; return; }
    const durationSeconds = (hours * 60 + minutes) * 60;
    if (!durationSeconds) { els.formError.textContent = 'A task needs at least one minute.'; return; }
    const existing = state.tasks.find((task) => task.id === els.editId.value);
    if (existing) {
      const previousDuration = existing.durationSeconds;
      const elapsed = existing.status === 'active' && state.schedule.status === 'running'
        ? Math.max(0, Math.floor((Date.now() - Number(state.schedule.segmentStartedAt)) / 1000)) : 0;
      existing.name = name; existing.durationSeconds = durationSeconds; existing.notes = note;
      if (existing.status === 'active') {
        if (state.schedule.status === 'running') state.schedule.segmentDurationSeconds = durationSeconds;
        if (state.schedule.status === 'paused') {
          const previousRemaining = Number(state.schedule.pausedRemainingSeconds ?? previousDuration);
          state.schedule.pausedRemainingSeconds = Math.max(0, previousRemaining + durationSeconds - previousDuration);
        }
      }
    } else {
      state.tasks.push({ id: uid(), name, durationSeconds, notes: note, status: 'pending', createdAt: Date.now() });
      if (state.schedule.status === 'completed' || state.schedule.status === 'stopped') state.schedule.status = 'idle';
    }
    saveState(); resetForm(); reconcileTimer(Date.now()); render();
  });

  els.cancelEdit.addEventListener('click', resetForm);
  $('#empty-add-button').addEventListener('click', scrollToComposer);

  els.taskList.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const row = event.target.closest('[data-task-id]');
    const index = state.tasks.findIndex((task) => task.id === row?.dataset.taskId);
    if (index < 0) return;
    const task = state.tasks[index];
    switch (action.dataset.action) {
      case 'edit':
        els.editId.value = task.id; els.taskName.value = task.name; els.notes.value = task.notes || '';
        els.hours.value = Math.floor(task.durationSeconds / 3600); els.minutes.value = Math.floor((task.durationSeconds % 3600) / 60);
        els.formTitle.textContent = 'Edit task'; els.submitTask.innerHTML = '<span aria-hidden="true">✓</span>Save changes';
        els.cancelEdit.classList.remove('hidden'); els.formError.textContent = ''; scrollToComposer(); break;
      case 'delete': {
        if (!window.confirm(`Delete “${task.name}” from today’s list?`)) return;
        const wasActive = task.id === state.schedule.currentTaskId;
        state.tasks.splice(index, 1);
        if (wasActive && ['running', 'paused'].includes(state.schedule.status)) {
          const now = Date.now();
          if (state.schedule.status === 'running') nextTaskAfter(now);
          else {
            const next = pendingTask();
            if (next) { next.status = 'active'; next.startedAt = now; state.schedule.currentTaskId = next.id; state.schedule.pausedRemainingSeconds = next.durationSeconds; }
            else { state.schedule.status = 'completed'; state.schedule.currentTaskId = null; }
          }
        }
        if (!state.tasks.length && ['completed', 'stopped'].includes(state.schedule.status)) state.schedule.status = 'idle';
        if (els.editId.value === task.id) resetForm();
        saveState(); render(); break;
      }
      case 'up':
      case 'down': {
        const otherIndex = index + (action.dataset.action === 'up' ? -1 : 1);
        if (otherIndex < 0 || otherIndex >= state.tasks.length) return;
        [state.tasks[index], state.tasks[otherIndex]] = [state.tasks[otherIndex], state.tasks[index]];
        saveState(); render(); break;
      }
      case 'restore':
        task.status = 'pending'; delete task.finishedAt; delete task.timeExpiredAt;
        if (state.schedule.status === 'completed') state.schedule.status = 'idle';
        saveState(); render(); break;
    }
  });

  els.taskList.addEventListener('change', (event) => {
    if (!event.target.matches('[data-action="complete"]')) return;
    const id = event.target.closest('[data-task-id]')?.dataset.taskId;
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    if (event.target.checked) {
      task.status = 'completed'; task.finishedAt = Date.now();
      if (task.id === state.schedule.currentTaskId && ['running', 'paused'].includes(state.schedule.status)) nextTaskAfter(Date.now());
    } else {
      task.status = 'pending'; delete task.finishedAt;
      if (state.schedule.status === 'completed') state.schedule.status = 'idle';
    }
    saveState(); render();
  });

  els.start.addEventListener('click', () => {
    if (state.schedule.status !== 'idle' || !pendingTask()) return;
    const now = Date.now();
    state.schedule.status = 'running'; state.schedule.startedAt ??= now;
    nextTaskAfter(now); saveState(); render();
  });

  els.pause.addEventListener('click', () => {
    if (state.schedule.status !== 'running') return;
    reconcileTimer(Date.now());
    if (state.schedule.status !== 'running') { render(); return; }
    const remaining = (Number(state.schedule.segmentStartedAt) + Number(state.schedule.segmentDurationSeconds) * 1000 - Date.now()) / 1000;
    state.schedule.pausedRemainingSeconds = Math.max(0, remaining);
    state.schedule.status = 'paused'; saveState(); render();
  });

  els.resume.addEventListener('click', () => {
    if (state.schedule.status !== 'paused') return;
    const task = currentTask();
    if (!task) { state.schedule.status = 'completed'; saveState(); render(); return; }
    const now = Date.now();
    const remaining = Math.max(0, Number(state.schedule.pausedRemainingSeconds ?? task.durationSeconds));
    state.schedule.status = 'running'; state.schedule.segmentStartedAt = now;
    state.schedule.segmentDurationSeconds = remaining; state.schedule.pausedRemainingSeconds = null;
    saveState(); render();
  });

  els.complete.addEventListener('click', () => {
    const task = currentTask(); if (!task) return;
    task.status = 'completed'; task.finishedAt = Date.now(); nextTaskAfter(Date.now()); saveState(); render();
  });

  els.skip.addEventListener('click', () => {
    const task = currentTask(); if (!task) return;
    task.status = 'skipped'; task.finishedAt = Date.now(); nextTaskAfter(Date.now()); saveState(); render();
  });

  els.extend.addEventListener('click', () => {
    const task = currentTask(); if (!task) return;
    const extraSeconds = 15 * 60;
    task.durationSeconds += extraSeconds;
    if (state.schedule.status === 'running') state.schedule.segmentDurationSeconds += extraSeconds;
    else state.schedule.pausedRemainingSeconds = Number(state.schedule.pausedRemainingSeconds ?? 0) + extraSeconds;
    saveState(); render(); showHint(`Added 15 minutes to “${task.name}”. Upcoming times have shifted.`);
  });

  els.stop.addEventListener('click', () => {
    if (!['running', 'paused'].includes(state.schedule.status)) return;
    if (!window.confirm('Stop today’s schedule? Your task list and completed work will stay saved.')) return;
    const active = currentTask(); if (active) active.status = 'pending';
    state.schedule.status = 'stopped'; state.schedule.currentTaskId = null;
    state.schedule.segmentStartedAt = null; state.schedule.segmentDurationSeconds = null; state.schedule.pausedRemainingSeconds = null;
    saveState(); render();
  });

  els.reset.addEventListener('click', () => {
    if (!state.tasks.length && state.schedule.status === 'idle') return;
    if (!window.confirm('Reset today’s run? All tasks will return to Pending.')) return;
    state.tasks.forEach((task) => { task.status = 'pending'; delete task.startedAt; delete task.finishedAt; delete task.timeExpiredAt; });
    state.schedule = freshState().schedule;
    saveState(); resetForm(); render();
  });

  function tick() {
    const now = Date.now();
    const changed = reconcileTimer(now);
    render(now);
    if (changed) saveState();
  }

  render();
  tick();
  window.setInterval(tick, 1000);
})();
