# Serein – TODO

## Milestone 1: Timer core
- [ ] TimerService with endDate-based countdown (accurate, background-safe)
- [ ] States: idle / running / paused / completedHolding
- [ ] Completion hold: 3 seconds
- [ ] Callback hook: onCompleted

## Milestone 2: Timer UI
- [ ] Minute picker 0–59
- [ ] Second picker (default 5-sec step)
- [ ] Start/Pause/Resume/End controls
- [ ] Running UI shows remaining time (MM:SS)
- [ ] CompletedHolding shows 00:00

## Milestone 3: Notifications
- [ ] Setting: None / Sound / Haptics / Both
- [ ] Implement sound (simple, minimal)
- [ ] Implement haptics (gentle)

## Milestone 4: Persistence
- [ ] SwiftData Session model
- [ ] Save completed session
- [ ] Save interrupted session (completed=false)

## Milestone 5: History
- [ ] Aggregations: day / week(Mon start) / month / all-time
- [ ] History UI: segment switch
- [ ] Numeric totals formatted as hh:mm:ss

## Milestone 6: Serein look
- [ ] Ripple background (teal-blue)
- [ ] Ring meter (non-goal style)
- [ ] Tap targets minimal, calm layout
