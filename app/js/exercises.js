/* ==========================================================================
   exercises.js — exercise catalogue from Eric Helms, "The Muscle & Strength
   Pyramid: Training" (2nd ed), Level 4 and the Accessory Exercises appendix
   (pp. 145-170, 248-254). Generated; edit the generator, not this file.

   `slots` lists which program slots an exercise may fill.
   `freeWeight` is used to honour the book's preference for free-weight or
   bodyweight versions when heavy low-rep pulls are prescribed (p. 248).
   ========================================================================== */

export const EXERCISES = [
  {
    "id": "bench-press-with-accommodating-resistance",
    "name": "Bench Press with Accommodating Resistance (bands or chains)",
    "short": "Bench Press with Accommodating Resistance",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant (p. 252). Alters the resistance curve so load rises as leverage improves; plausibly useful for weakness near lockout, and prevents the light-load braking phase during speed work (pp. 161-162). No average advantage in meta-analysis.",
    "fixes": [
      "bench:weakness_near_lockout",
      "bench:stuck_right_off_the_chest"
    ]
  },
  {
    "id": "board-press",
    "name": "Board Press",
    "short": "Board Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "triceps",
      "chest",
      "anterior delts"
    ],
    "secondary": [],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant (p. 252) and named in the strength category chart (pp. 148, 215). A reduced-ROM bench variant. Reminder from the ROM discussion: partial-ROM training transfers poorly to full-ROM strength, so retain some full-range benching (pp. 165-166).",
    "fixes": []
  },
  {
    "id": "close-grip-bench-press",
    "name": "Close-Grip Bench Press",
    "short": "Close-Grip Bench Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "triceps",
      "chest",
      "anterior delts"
    ],
    "secondary": [],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant (p. 252) and named in the strength category chart as 'CGBP' (pp. 148, 215). MUST NOT be extremely close — just closer relative to your competition grip; the narrowest allowable grip is about push-up width with elbows tucked at your sides (p. 252). Advised specifically for lifters who bench wide (p. 228) and as a way to accumulate pressing volume when the competition bench causes elbow/shoulder pain (p. 158). Triceps are a PRIMARY mover on close-grip pressing (p. 84).",
    "fixes": [
      "bench:wide_grip_bencher_weak_point_variation",
      "bench:elbow_and_shoulder_pain_limits_bench_volume"
    ]
  },
  {
    "id": "explosive-speed-bench-press",
    "name": "Explosive / Speed Bench Press",
    "short": "Explosive / Speed Bench Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Proposed for lifters who get stuck right off the chest — raise RFD prior to the sticking point, ideally with accommodating resistance. Individual responsiveness (p. 162).",
    "fixes": [
      "bench:stuck_right_off_the_chest"
    ]
  },
  {
    "id": "feet-up-bench-press",
    "name": "Feet-Up Bench Press",
    "short": "Feet-Up Bench Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant (p. 252). Removes leg drive.",
    "fixes": []
  },
  {
    "id": "flat-back-bench-press",
    "name": "Flat-Back Bench Press",
    "short": "Flat-Back Bench Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant — bench without the competition arch (p. 252).",
    "fixes": []
  },
  {
    "id": "long-pause-bench-press",
    "name": "Long-Pause Bench Press (e.g. 2-count)",
    "short": "Long-Pause Bench Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant (p. 252). Rationale (p. 160): you never know how long you'll wait for the press command, so getting better at generating force from a dead stop may help on comp day — use longer chest pauses as competition approaches.",
    "fixes": [
      "bench:cannot_generate_force_from_a_dead_stop_slow_press_command"
    ]
  },
  {
    "id": "wide-grip-bench-press",
    "name": "Wide-Grip Bench Press",
    "short": "Wide-Grip Bench Press",
    "category": "Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "variation",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "benchVariant"
    ],
    "freeWeight": true,
    "notes": "Named bench variant — 'a closer or wider grip' relative to your competition grip (p. 252). Use if a technical fault is well suited to it.",
    "fixes": []
  },
  {
    "id": "deadlift-with-accommodating-resistance",
    "name": "Deadlift with Accommodating Resistance (bands or chains)",
    "short": "Deadlift with Accommodating Resistance",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "lats",
      "upper back"
    ],
    "slots": [
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "Named deadlift variant (p. 251). Increases load as leverage improves toward lockout; plausibly useful for lockout weakness, and removes the braking phase in speed pulls (pp. 161-162). No average advantage in meta-analysis.",
    "fixes": [
      "deadlift:weakness_near_lockout",
      "deadlift:cannot_break_the_bar_off_the_ground"
    ]
  },
  {
    "id": "explosive-speed-deadlift",
    "name": "Explosive / Speed Deadlift",
    "short": "Explosive / Speed Deadlift",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "lats"
    ],
    "slots": [
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "Proposed for lifters who can't break the bar off the ground — improve RFD prior to the sticking point, ideally with bands/chains. Individual responsiveness (p. 162).",
    "fixes": [
      "deadlift:cannot_break_the_bar_off_the_ground"
    ]
  },
  {
    "id": "good-morning",
    "name": "Good Morning",
    "short": "Good Morning",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "scapular retractors"
    ],
    "slots": [
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "Named deadlift variant (p. 251) and named in the hypertrophy hinge chart (p. 84) and the strength compound-accessory rep table (4-8 reps @ RPE 6-9, p. 210). RECOMMENDED alongside the RDL when a deadlift variant is programmed for 6+ reps (automatically controlled eccentric); needs more kinesthetic awareness to master heavy (p. 251). Note: 'squat mornings' are a FAULT in the squat, not an endorsement of the exercise there (p. 160).",
    "fixes": [
      "deadlift:thoracic_or_lumbar_flexion_at_maximal_loads"
    ]
  },
  {
    "id": "modified-rom-deadlift",
    "name": "Modified-ROM Deadlift (deficit / blocks / rack)",
    "short": "Modified-ROM Deadlift",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "lats",
      "upper back"
    ],
    "slots": [
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "'Deadlifts with a modified range of motion' is a named deadlift variant (p. 251); the strength category chart also allows limited or increased ROM variations (p. 163). Use intentionally for a specific technical fault or sticking region; keep some full-range work because partial-ROM strength transfers poorly to full-ROM (pp. 163, 166).",
    "fixes": [
      "deadlift:region_specific_weakness"
    ]
  },
  {
    "id": "pause-deadlift",
    "name": "Pause Deadlift",
    "short": "Pause Deadlift",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "lats",
      "upper back"
    ],
    "slots": [
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "Named in the strength category chart as an upper-body-pull exercise (pp. 148, 215). 'There is nothing wrong with pausing below the knee on a deadlift. If you often let the bar drift out in front of you, pausing here might teach you to keep the bar close' — a useful way to chunk the lift for motor learning (p. 159). Do NOT pause at the visible sticking point (p. 159).",
    "fixes": [
      "deadlift:bar_drifts_out_in_front"
    ]
  },
  {
    "id": "romanian-deadlift",
    "name": "Romanian Deadlift (RDL)",
    "short": "Romanian Deadlift",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "scapular retractors",
      "upper back"
    ],
    "slots": [
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "Named deadlift variant (p. 251) and named in the strength category chart (pp. 148, 215). RECOMMENDED whenever a deadlift variant is programmed for 6+ reps because the eccentric is automatically controlled; cost is that it takes more kinesthetic awareness and time to master heavy (p. 251). Retaining scapular retraction and lumbar extension takes a lot of effort, so it counts as meaningful back work (p. 91). Prescribed as posterior-chain complement for lifters better suited to front squats/leg press (p. 155). Take max tests to technical failure only (p. 237). Reps 3-8 @ RPE 5-8 as a lower free-weight compound (p. 209).",
    "fixes": [
      "deadlift:thoracic_or_lumbar_flexion_at_maximal_loads"
    ]
  },
  {
    "id": "sumo-deadlift",
    "name": "Sumo Deadlift",
    "short": "Sumo Deadlift",
    "category": "Deadlift Variants",
    "pattern": "hinge",
    "type": "variation",
    "muscles": [
      "glutes",
      "hams",
      "quads",
      "erectors"
    ],
    "secondary": [
      "scapular retractors",
      "adductors"
    ],
    "slots": [
      "deadlift",
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "Named deadlift variant (p. 251). For a bodybuilder (non-competitor): do NOT go ultra-wide — use a stance just slightly wider than your hand position; this allows a straighter back and more upright torso, reducing injury risk while mimicking conventional deadlift biomechanics (p. 251).",
    "fixes": []
  },
  {
    "id": "chair-dips",
    "name": "Chair Dips (feet up, load on torso/lap)",
    "short": "Chair Dips",
    "category": "Dips",
    "pattern": "horizontal_push",
    "type": "accessory",
    "muscles": [
      "triceps"
    ],
    "secondary": [
      "anterior delts"
    ],
    "slots": [
      "verticalPush"
    ],
    "freeWeight": true,
    "notes": "Injury workaround for standard dips — 'but this removes the pecs from the equation' (p. 252).",
    "fixes": []
  },
  {
    "id": "dips",
    "name": "Dips (parallel bars / dip station)",
    "short": "Dips",
    "category": "Dips",
    "pattern": "horizontal_push",
    "type": "accessory",
    "muscles": [
      "triceps",
      "chest",
      "anterior delts"
    ],
    "secondary": [],
    "slots": [
      "verticalPush"
    ],
    "freeWeight": true,
    "notes": "Add weight as needed to reach the target intensity/rep combination (p. 252). Triceps are a PRIMARY mover (p. 84). Programmed 3 sets of 7-12 reps @ RPE 6.5-8.5 in the advanced bodybuilding program (pp. 268-272).",
    "fixes": []
  },
  {
    "id": "single-arm-bodyweight-hang-for-time",
    "name": "Single-Arm Bodyweight Hang for Time",
    "short": "Single-Arm Hang",
    "category": "Grip Work",
    "pattern": "grip",
    "type": "accessory",
    "muscles": [
      "forearm flexors (grip)"
    ],
    "secondary": [
      "lats",
      "scapular stabilizers"
    ],
    "slots": [
      "grip"
    ],
    "freeWeight": true,
    "notes": "Grip-work option: 3 sets of 10-20 s. 'A good choice when your spine is fatigued from compression' (p. 253).",
    "fixes": [
      "deadlift:grip_fails_pulls_more_with_straps_than_chalk"
    ]
  },
  {
    "id": "rack-partial-hold",
    "name": "Rack Partial Deadlift / Timed Barbell Hold near Lockout",
    "short": "Rack Partial Hold",
    "category": "Grip Work / Deadlift Variants",
    "pattern": "grip",
    "type": "variation",
    "muscles": [
      "forearm flexors (grip)"
    ],
    "secondary": [
      "upper back",
      "traps",
      "erectors"
    ],
    "slots": [
      "grip",
      "deadliftVariant"
    ],
    "freeWeight": true,
    "notes": "The book's primary grip-strength prescription. Diagnostic: you pull more with straps than with chalk (p. 156). Do a partial deadlift from the rack nearly at lockout with a high %1RM and hold the loaded barbell for time; progress time and load over subsequent cycles until resolved (p. 157). Programmed spec: 3 sets of 10-20 s holds at 90-110% of max, built up over time (p. 253).",
    "fixes": [
      "deadlift:grip_fails_pulls_more_with_straps_than_chalk"
    ]
  },
  {
    "id": "barbell-hip-thrust",
    "name": "Barbell Hip Thrust",
    "short": "Barbell Hip Thrust",
    "category": "Hip Hinge Variants",
    "pattern": "horizontal_hip_extension",
    "type": "accessory",
    "muscles": [
      "glutes"
    ],
    "secondary": [
      "hams"
    ],
    "slots": [
      "hipHingeVariant"
    ],
    "freeWeight": true,
    "notes": "Named hip hinge variant (p. 251); its own movement pattern in the hypertrophy chart (glutes primary, hams secondary) (p. 84). Usable as one of the only lower-body options when a lower-back injury forces a workaround — 3DMJ prepped show winners on hip thrusts, leg extensions and leg curls alone (p. 42).",
    "fixes": []
  },
  {
    "id": "cable-machine-hinge",
    "name": "Cable / Machine Hinge (Pull Through)",
    "short": "Pull Through",
    "category": "Hip Hinge Variants",
    "pattern": "hinge",
    "type": "accessory",
    "muscles": [
      "glutes",
      "hams"
    ],
    "secondary": [
      "erectors"
    ],
    "slots": [
      "hipHingeVariant"
    ],
    "freeWeight": false,
    "notes": "'Cable or machine hinges (like a pull through) can also be used' as a hip hinge variant (p. 251).",
    "fixes": []
  },
  {
    "id": "glute-bridge",
    "name": "Glute Bridge (barbell or Smith machine)",
    "short": "Glute Bridge",
    "category": "Hip Hinge Variants",
    "pattern": "horizontal_hip_extension",
    "type": "accessory",
    "muscles": [
      "glutes"
    ],
    "secondary": [
      "hams"
    ],
    "slots": [
      "hipHingeVariant"
    ],
    "freeWeight": false,
    "notes": "Named hip hinge variant; 'you can use the Smith machine' (p. 251). Same muscle map as the hip thrust (p. 84).",
    "fixes": []
  },
  {
    "id": "glute-ham-raise",
    "name": "Glute Ham Raise",
    "short": "Glute Ham Raise",
    "category": "Hip Hinge Variants",
    "pattern": "hinge",
    "type": "accessory",
    "muscles": [
      "hams",
      "glutes",
      "erectors"
    ],
    "secondary": [
      "scapular retractors"
    ],
    "slots": [
      "hipHingeVariant"
    ],
    "freeWeight": true,
    "notes": "Named hip hinge variant. Trains the posterior chain without loading the upper body like a deadlift variant; slotted in to reduce lumbar and hip fatigue (pp. 250-251). AMRAP-based 1RM estimation is less accurate on hinge variants (p. 251).",
    "fixes": []
  },
  {
    "id": "reverse-hyperextension",
    "name": "Reverse Hyperextension",
    "short": "Reverse Hyperextension",
    "category": "Hip Hinge Variants",
    "pattern": "hinge",
    "type": "accessory",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [],
    "slots": [
      "hipHingeVariant"
    ],
    "freeWeight": true,
    "notes": "Named hip hinge variant used to train the posterior chain with reduced lumbar/hip fatigue (p. 251).",
    "fixes": []
  },
  {
    "id": "weighted-back-extension",
    "name": "Weighted Back Extension",
    "short": "Weighted Back Extension",
    "category": "Hip Hinge Variants",
    "pattern": "hinge",
    "type": "accessory",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "scapular retractors"
    ],
    "slots": [
      "hipHingeVariant"
    ],
    "freeWeight": true,
    "notes": "Named hip hinge variant (p. 251); also named in the hypertrophy hinge chart as 'back ext' (p. 84). Trains glutes, hams and lumbar extensors (p. 92). Appears as 'Wt B Ext' 3x8-12 @ RPE 8 in the intermediate bodybuilding program (p. 264).",
    "fixes": []
  },
  {
    "id": "bicep-curl",
    "name": "Bicep Curl",
    "short": "Bicep Curl",
    "category": "Isolation Exercises",
    "pattern": "isolation_elbow_flexion",
    "type": "isolation",
    "muscles": [
      "biceps"
    ],
    "secondary": [],
    "slots": [
      "biceps"
    ],
    "freeWeight": true,
    "notes": "Free weights, machines, cables — your choice; full ROM, pain-free (p. 253). Low complexity, mastered quickly, so it can be rotated frequently (pp. 149, 152-153). Safe to train to failure after compounds (p. 67). A named case where a bodybuilder with weak biceps may train it FIRST, before overhead or bench press, since it won't hurt those lifts (p. 164). APS partner for triceps extensions at ~1 min rest (p. 179). Progression warning: 5 lb on a 50 lb curl is a 10% jump — relative increments matter (pp. 169-170).",
    "fixes": []
  },
  {
    "id": "face-pull",
    "name": "Face Pull",
    "short": "Face Pull",
    "category": "Isolation Exercises",
    "pattern": "horizontal_pull",
    "type": "isolation",
    "muscles": [
      "rear delts",
      "scapular retractors"
    ],
    "secondary": [
      "middle delts"
    ],
    "slots": [
      "facePull",
      "horizontalPull2"
    ],
    "freeWeight": true,
    "notes": "Programmed in both the advanced powerlifting program (3 sets of 10-12 reps @ RPE 6-8, pp. 265-266) and the intermediate/advanced bodybuilding programs (2 sets of 12-15 reps @ RPE 6.5-8.5, pp. 264, 268-272) as rear-delt and upper-back work.",
    "fixes": []
  },
  {
    "id": "fly",
    "name": "Fly (cable crossover / dumbbell / machine)",
    "short": "Fly",
    "category": "Isolation Exercises",
    "pattern": "fly",
    "type": "isolation",
    "muscles": [
      "chest"
    ],
    "secondary": [
      "anterior delts"
    ],
    "slots": [],
    "freeWeight": false,
    "notes": "'Flys can be performed with cables or dumbbells or machines and can be performed at incline or decline angles if preferred' (p. 253). Own movement pattern in the hypertrophy chart: chest primary, anterior delts secondary (p. 84). Programmed 4 sets of 9-12 reps @ RPE 7-9 in the advanced bodybuilding program.",
    "fixes": []
  },
  {
    "id": "front-raise",
    "name": "Front Raise",
    "short": "Front Raise",
    "category": "Isolation Exercises",
    "pattern": "isolation_shoulder_flexion",
    "type": "isolation",
    "muscles": [
      "anterior delts"
    ],
    "secondary": [],
    "slots": [],
    "freeWeight": true,
    "notes": "Helms 'almost never includes front raises in programs' — anterior delts are already heavily trained by all the compound pressing, which is why their programmed volume looks disproportionately high (p. 233). Also used as the example of an INVALID superset pairing: shoulder press followed by a front raise is not an antagonist pairing (p. 177).",
    "fixes": []
  },
  {
    "id": "lateral-raise",
    "name": "Lateral Raise",
    "short": "Lateral Raise",
    "category": "Isolation Exercises",
    "pattern": "isolation_shoulder_abduction",
    "type": "isolation",
    "muscles": [
      "middle delts"
    ],
    "secondary": [],
    "slots": [],
    "freeWeight": true,
    "notes": "Importance not disputed and it appears in the sample hypertrophy programs, BUT middle delts contribute significantly to most pushes and pulls — most notably horizontal pulling and vertical pushing — so 'they get hit all the time. You only need to spend time isolating them if you are advanced, and they are a clear weak point' (p. 85). Upper isolation: 8-20 reps @ RPE 7-10 (p. 209). Safe failure vehicle (p. 68). Programmed 3 sets of 12-15 reps in the advanced bodybuilding program.",
    "fixes": []
  },
  {
    "id": "leg-curl",
    "name": "Leg Curl (seated / lying / standing / single-leg)",
    "short": "Leg Curl",
    "category": "Isolation Exercises",
    "pattern": "isolation_knee_flexion",
    "type": "isolation",
    "muscles": [
      "hams"
    ],
    "secondary": [
      "calves (gastrocnemius, slightly)"
    ],
    "slots": [
      "legCurl"
    ],
    "freeWeight": true,
    "notes": "Full ROM, pain-free (p. 253). PROGRAMMING CONVENTION: 'Leg Curl 1' and 'Leg Curl 2' on different days means use two DIFFERENT variations of the same movement — e.g. seated one day, lying the other (or standing if available); if you only have one machine, single-leg one day and bilateral the other (p. 253). Rationale for direct hamstring work: the short head of the biceps femoris only crosses the knee, so it may be underdeveloped if only hip-extension movements are trained (p. 256). Gastrocnemius crosses the knee so leg curls hit calves slightly (p. 93). APS partner for leg extensions (p. 179). Usable with a lower-back injury (p. 42).",
    "fixes": []
  },
  {
    "id": "leg-extension",
    "name": "Leg Extension",
    "short": "Leg Extension",
    "category": "Isolation Exercises",
    "pattern": "isolation_knee_extension",
    "type": "isolation",
    "muscles": [
      "quads"
    ],
    "secondary": [],
    "slots": [],
    "freeWeight": true,
    "notes": "Full ROM, pain-free (p. 253). Targets the RECTUS FEMORIS more than squats do, while squats better train vastus lateralis, medialis and intermedius — hence its inclusion for a powerlifter competing in bodybuilding (p. 256). Safe to train to failure (p. 67). APS partner for leg curls at ~1 min rest (pp. 179, 216). One of the few lower-body options usable with a lower-back injury (p. 42). Lower isolation: 8-20 reps @ RPE 7-10 (p. 209).",
    "fixes": []
  },
  {
    "id": "pullover-and-cable-lat-pushdown",
    "name": "Pullover (dumbbell / barbell / cable) and Cable Lat Pushdown (straight-arm pulldown)",
    "short": "Pulloverand Cable Lat Pushdown",
    "category": "Isolation Exercises",
    "pattern": "pull_over",
    "type": "isolation",
    "muscles": [
      "lats"
    ],
    "secondary": [
      "triceps",
      "chest"
    ],
    "slots": [],
    "freeWeight": false,
    "notes": "Its own movement pattern in the hypertrophy chart: lats primary; triceps and chest secondary — because the pec assists shoulder extension (it is stretched overhead and aids the movement when it contracts) and the triceps cross the shoulder (pp. 83-84). Used in the sample strength routine 'to complement the fact that a bench press isn't as effective for middle delts or triceps as it is for chest and anterior delts' (p. 90).",
    "fixes": []
  },
  {
    "id": "seated-calf-raise",
    "name": "Seated Calf Raise (bent knee)",
    "short": "Seated Calf Raise",
    "category": "Isolation Exercises",
    "pattern": "isolation_plantarflexion",
    "type": "isolation",
    "muscles": [
      "calves (soleus)"
    ],
    "secondary": [],
    "slots": [
      "calf"
    ],
    "freeWeight": true,
    "notes": "Programmed at higher reps than standing calf work (e.g. 4-5 sets of 12-15) in the sample programs (pp. 262-272). Full ROM, pain-free (p. 253).",
    "fixes": []
  },
  {
    "id": "seated-hip-abduction",
    "name": "Seated Hip Abduction",
    "short": "Seated Hip Abduction",
    "category": "Isolation Exercises",
    "pattern": "isolation_hip_abduction",
    "type": "isolation",
    "muscles": [
      "glutes"
    ],
    "secondary": [],
    "slots": [],
    "freeWeight": true,
    "notes": "Appears in the sample hypertrophy routine at 3 sets of 12-15 reps to isolate the glutes (p. 92).",
    "fixes": []
  },
  {
    "id": "shrug",
    "name": "Shrug",
    "short": "Shrug",
    "category": "Isolation Exercises",
    "pattern": "isolation_scapular_elevation",
    "type": "isolation",
    "muscles": [
      "upper traps"
    ],
    "secondary": [],
    "slots": [],
    "freeWeight": true,
    "notes": "Deliberately EXCLUDED from the bodybuilding programs (p. 254): Helms has never seen shrugs reliably improve trap development in a plan already containing free-weight rows, squats, deadlifts and presses, and has removed them from such plans without detriment. Exception: prescribed for lifters who specifically have weak upper traps — 'that's just common sense and even if it's not successful, it's worth the attempt.'",
    "fixes": []
  },
  {
    "id": "standing-calf-raise",
    "name": "Standing Calf Raise (straight-legged)",
    "short": "Standing Calf Raise",
    "category": "Isolation Exercises",
    "pattern": "isolation_plantarflexion",
    "type": "isolation",
    "muscles": [
      "calves (gastrocnemius)"
    ],
    "secondary": [],
    "slots": [
      "calf"
    ],
    "freeWeight": true,
    "notes": "'Standing calf raises don't necessarily need to be standing, they just need to be STRAIGHT LEGGED (for example a calf raise on a leg press)' (p. 253). Named case where calves may be trained FIRST in a session, before squats or deadlifts, because pre-fatiguing them has minimal effect on those lifts (pp. 164-165). Calf volume looks deceptively low in the programs because leg curls and squat/single-leg patterns train them indirectly (pp. 232, 235).",
    "fixes": []
  },
  {
    "id": "triceps-extension",
    "name": "Triceps Extension / Tricep Pushdown",
    "short": "Triceps Extension",
    "category": "Isolation Exercises",
    "pattern": "isolation_elbow_extension",
    "type": "isolation",
    "muscles": [
      "triceps"
    ],
    "secondary": [],
    "slots": [
      "triceps"
    ],
    "freeWeight": true,
    "notes": "Free weights, machines or cables; full ROM, pain-free (p. 253). Listed under Upper Body Push for strength athletes as 'triceps work' (pp. 148, 215). Upper isolation: 8-20 reps @ RPE 7-10 for hypertrophy (p. 209); machine/isolation accessory 8-15 @ RPE 7-10 for strength (p. 210). APS partner for bicep curls (p. 179). Note the long head crosses the shoulder and assists shoulder extension, so it is also fatigued by pulling (pp. 83, 178).",
    "fixes": []
  },
  {
    "id": "weighted-ab-exercise",
    "name": "Weighted Ab Exercise",
    "short": "Weighted Ab Exercise",
    "category": "Isolation Exercises",
    "pattern": "core",
    "type": "isolation",
    "muscles": [
      "abdominals"
    ],
    "secondary": [],
    "slots": [
      "weightedAb"
    ],
    "freeWeight": true,
    "notes": "Programmed as 'Wt Ab' 3 sets of 8-10 reps @ RPE 6-8 in the advanced powerlifting program (pp. 265-266). Deliberately ABSENT from the bodybuilding programs (p. 254) — Helms has never seen direct ab work improve abs in an already compound-heavy, well-balanced plan. Exception: if you genuinely have weak abdominals (not just fat held in the midsection), add a few sets per week.",
    "fixes": []
  },
  {
    "id": "hack-squat",
    "name": "Hack Squat",
    "short": "Hack Squat",
    "category": "Leg Press Variants",
    "pattern": "squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [],
    "slots": [
      "legPress",
      "squatVariant"
    ],
    "freeWeight": false,
    "notes": "Named leg-press variant (p. 250); classified as a lower machine compound, reps 6-12 @ RPE 6-9 (p. 209). Choose whichever variation you can perform full-ROM and pain-free.",
    "fixes": [
      "squat:excessive_forward_lean_poor_quad_development"
    ]
  },
  {
    "id": "leg-press",
    "name": "Leg Press",
    "short": "Leg Press",
    "category": "Leg Press Variants",
    "pattern": "squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [],
    "slots": [
      "legPress",
      "squatVariant"
    ],
    "freeWeight": false,
    "notes": "Squat-like loading without supporting the load with the upper body; slotted into programs specifically to reduce lower-back and hip fatigue and stress (p. 250). Prescribed for quad development in long-femur / low-bar squatters and for those with lumbar pain from squatting (pp. 155, 158). Substitute for a squat variant when injury prevents barbell squatting (p. 250). One of the safer compound movements to train near failure (p. 67). Preferred over high-rep squats when peaking a powerlifter for a bodybuilding show (p. 256). Reps 6-12 @ RPE 6-9 (p. 209). Full ROM also slightly trains calves (p. 93).",
    "fixes": [
      "squat:excessive_forward_lean_poor_quad_development"
    ]
  },
  {
    "id": "smith-machine-squat",
    "name": "Smith Machine Squat",
    "short": "Smith Machine Squat",
    "category": "Leg Press Variants",
    "pattern": "squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [],
    "slots": [
      "legPress",
      "squatVariant"
    ],
    "freeWeight": false,
    "notes": "Counts as a leg-press variant ONLY if the legs are placed out in front and you lean back into the bar to keep an upright torso (p. 250). Less complex than a free-weight squat ('there's less ability to screw up a Smith machine squat'), and training it exclusively produced less uniform quad growth than a four-exercise program (pp. 150-151, 153).",
    "fixes": []
  },
  {
    "id": "bench-press",
    "name": "Bench Press (competition)",
    "short": "Bench Press",
    "category": "Main Lift / Bench Press Variants",
    "pattern": "horizontal_push",
    "type": "main",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [
      "bench"
    ],
    "freeWeight": true,
    "notes": "Competition lift. Mastery required. Typical hardest point is a few inches above the chest (p. 161). A controlled/slow eccentric is ideal because the press command isn't given until the bar is visibly motionless (p. 199). Helms advises caution using APS with the powerlifting bench because leg drive makes it a full-body lift (p. 180). Mind-muscle cueing stops working at >=80% 1RM (p. 163).",
    "fixes": []
  },
  {
    "id": "deadlift",
    "name": "Deadlift (conventional, competition)",
    "short": "Deadlift",
    "category": "Main Lift / Deadlift Variants",
    "pattern": "hinge",
    "type": "main",
    "muscles": [
      "glutes",
      "hams",
      "erectors"
    ],
    "secondary": [
      "scapular retractors",
      "lats",
      "upper back"
    ],
    "slots": [
      "deadlift"
    ],
    "freeWeight": true,
    "notes": "Competition lift. Counts toward BOTH lower-body and upper-body-pull volume (p. 226). Typically hardest below the knee (p. 161). Works the entire back to a degree just to maintain position (p. 91). No APS around deadlifts (p. 180). Take AMRAP/max tests to technical failure, not absolute failure (p. 237). A powerlifter may deliberately drop the bar (no eccentric) during pure-practice periods (p. 199).",
    "fixes": []
  },
  {
    "id": "back-squat-low-bar",
    "name": "Back Squat (competition, low-bar)",
    "short": "Low-Bar Back Squat",
    "category": "Main Lift / Squat Variants",
    "pattern": "squat",
    "type": "main",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "erectors",
      "upper back"
    ],
    "slots": [
      "squat"
    ],
    "freeWeight": true,
    "notes": "Competition lift; must be trained regardless of biomechanical suitability (p. 157). Low-bar keeps the load closer to the center of gravity for a biomechanical advantage but increases forward lean, reduces knee travel (less quad ROM) and raises lumbar stress in long-femur lifters — keep volume lower and add quad-biased accessories (pp. 157-158). No APS around squats (p. 180).",
    "fixes": []
  },
  {
    "id": "bulgarian-split-squat",
    "name": "Bulgarian Split Squat",
    "short": "Bulgarian Split Squat",
    "category": "Single-leg Squat Variants",
    "pattern": "single_leg_squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "hams",
      "erectors"
    ],
    "slots": [
      "singleLeg"
    ],
    "freeWeight": true,
    "notes": "Preferred free-weight single-leg option (p. 252). Purpose of the whole category: ensure equal development across legs and adequate coordination/even force contribution in bipedal lifts, reducing injury risk (p. 252).",
    "fixes": []
  },
  {
    "id": "lunge",
    "name": "Lunge",
    "short": "Lunge",
    "category": "Single-leg Squat Variants",
    "pattern": "single_leg_squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "hams",
      "erectors"
    ],
    "slots": [
      "singleLeg"
    ],
    "freeWeight": true,
    "notes": "Preferred free-weight single-leg option (p. 252). Was one of the four exercises in the 2014 study whose varied program beat Smith-squat-only for 1RM strength and quad-head uniformity (p. 150). Treated as a 'full-body exercise' — do NOT use APS around lunges; just rest (pp. 180-181).",
    "fixes": []
  },
  {
    "id": "single-leg-leg-press",
    "name": "Single-Leg Leg Press",
    "short": "Single-Leg Leg Press",
    "category": "Single-leg Squat Variants",
    "pattern": "single_leg_squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [],
    "slots": [
      "singleLeg"
    ],
    "freeWeight": false,
    "notes": "Machine single-leg option. 'This will only help you ensure equal force production between legs, and not necessarily coordination and balance. Thus, the injury prevention effect will be reduced; however, heavier loaded single-leg squats sometimes are better suited to machine based options' (p. 253).",
    "fixes": []
  },
  {
    "id": "single-leg-squat",
    "name": "Single-Leg Squat (kettlebell/dumbbell, floor or off a plyo box)",
    "short": "Single-Leg Squat",
    "category": "Single-leg Squat Variants",
    "pattern": "single_leg_squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "hams"
    ],
    "slots": [
      "singleLeg"
    ],
    "freeWeight": true,
    "notes": "Preferred free-weight single-leg option — 'with a kettlebell or dumbbell on the floor if you have the mobility, or with one leg off a plyo box' (pp. 252-253). Bodyweight or band-assisted versions are acceptable if you can't yet add external load.",
    "fixes": []
  },
  {
    "id": "step-up",
    "name": "Step Up",
    "short": "Step Up",
    "category": "Single-leg Squat Variants",
    "pattern": "single_leg_squat",
    "type": "accessory",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "hams"
    ],
    "slots": [
      "singleLeg"
    ],
    "freeWeight": true,
    "notes": "Preferred free-weight single-leg option (p. 252).",
    "fixes": []
  },
  {
    "id": "back-squat-high-bar",
    "name": "Back Squat (high-bar)",
    "short": "High-Bar Back Squat",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "erectors"
    ],
    "slots": [
      "squat",
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "Bar across the top of the traps; allows a more upright torso than low-bar. Advised as the Day-1 higher-volume squat variation to give the hips a break if you compete low-bar (p. 228). Also a better quad-development choice for long-femur lifters (p. 250).",
    "fixes": [
      "squat:excessive_forward_lean_poor_quad_development",
      "squat:hip_and_lumbar_fatigue_from_low_bar"
    ]
  },
  {
    "id": "explosive-speed-squat",
    "name": "Explosive / Speed Squat",
    "short": "Explosive / Speed Squat",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "erectors"
    ],
    "slots": [
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "Proposed to raise rate of force development prior to a sticking point; best combined with bands/chains to avoid the deceleration/braking phase near lockout. Response to explosive training is highly individual (p. 162).",
    "fixes": [
      "squat:stuck_in_the_hole"
    ]
  },
  {
    "id": "front-squat",
    "name": "Front Squat",
    "short": "Front Squat",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "upper back",
      "erectors"
    ],
    "slots": [
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "The book's flagship 'punish the fault / reward the fix' variation: it will be 'almost immediately dumped forward and lost if your hips shoot up and you lose back tightness'; maintaining the rack position requires intentional focus and provides an anti-flexion challenge to the back extensors (pp. 160-161). Also prescribed for quad development in low-bar squatters (p. 158) and as an upright variation to spare the hips (p. 228). Limiting factor is upper-back ability to hold the rack position, so it also counts as upper-back work (p. 91). Take AMRAP/max tests to technical failure only (p. 237).",
    "fixes": [
      "squat:squat_mornings_hips_shoot_up_loss_of_back_tightness",
      "squat:excessive_forward_lean_poor_quad_development",
      "squat:hip_and_lumbar_fatigue_from_low_bar"
    ]
  },
  {
    "id": "pause-squat",
    "name": "Pause Squat",
    "short": "Pause Squat",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "erectors"
    ],
    "slots": [
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "Pausing IN THE HOLE lets elastic energy dissipate and gives you time to attend to and generate tightness, improving control of the eccentric-to-concentric transition when you return to normal squats (p. 160). Do NOT pause at the visible sticking point — that trains you to reduce force there, and the visible stick is downstream of the real force deficit (p. 159).",
    "fixes": [
      "squat:loses_tightness_out_of_the_hole_cannot_control_the_bounce"
    ]
  },
  {
    "id": "safety-bar-squat",
    "name": "Safety Bar Squat",
    "short": "Safety Bar Squat",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "erectors",
      "upper back"
    ],
    "slots": [
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "Named permissible barbell squat variant (p. 250); explicitly advised as an upright variation to give the hips a break if you squat low-bar (p. 228). Also named in the strength category chart (p. 148/215).",
    "fixes": [
      "squat:excessive_forward_lean_poor_quad_development",
      "squat:hip_and_lumbar_fatigue_from_low_bar"
    ]
  },
  {
    "id": "squat-with-accommodating-resistance",
    "name": "Squat with Accommodating Resistance (bands or chains)",
    "short": "Squat with Accommodating Resistance",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "erectors"
    ],
    "slots": [
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "Chains/bands make the load progressively heavier through the concentric, offsetting the improving leverage toward lockout (p. 161). Meta-analysis shows no average advantage over traditional resistance, and no study has tested equipped 1RM (p. 161). Plausibly useful for individuals weak near lockout, and it removes the light-load 'braking' phase so speed work can accelerate through the full ROM (p. 162).",
    "fixes": [
      "squat:weakness_near_lockout",
      "squat:stuck_in_the_hole"
    ]
  },
  {
    "id": "zercher-squat",
    "name": "Zercher Squat",
    "short": "Zercher Squat",
    "category": "Squat Variants",
    "pattern": "squat",
    "type": "variation",
    "muscles": [
      "quads",
      "glutes"
    ],
    "secondary": [
      "upper back",
      "erectors"
    ],
    "slots": [
      "squatVariant"
    ],
    "freeWeight": true,
    "notes": "Named permissible barbell squat variant (p. 250). Choose it if it is pain-free, low risk, enjoyable, masterable and suits your biomechanics; allows a more upright position than low-bar.",
    "fixes": [
      "squat:excessive_forward_lean_poor_quad_development"
    ]
  },
  {
    "id": "isometric-hold-at-point-of-force-deficit",
    "name": "Isometric Hold at Point of Force Deficit",
    "short": "Isometric Hold at Point of Force Deficit",
    "category": "Sticking-Point Methods",
    "pattern": "isometric",
    "type": "variation",
    "muscles": [
      "lift-specific"
    ],
    "secondary": [],
    "slots": [],
    "freeWeight": true,
    "notes": "Pressing against an immovable object at the point in the ROM where you are weak may be a way to get stronger at a sticking point. Problem: distinguishing where you are actually weak from the visible point where momentum stopped carrying you requires motion capture / lab equipment or at least video analysis (pp. 160, 162).",
    "fixes": [
      "squat:joint_angle_specific_force_deficit",
      "bench:joint_angle_specific_force_deficit",
      "deadlift:joint_angle_specific_force_deficit"
    ]
  },
  {
    "id": "band-assisted-pull-up",
    "name": "Band-Assisted Pull Up",
    "short": "Band-Assisted Pull Up",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "vertical_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "biceps"
    ],
    "secondary": [
      "rear delts"
    ],
    "slots": [
      "verticalPull"
    ],
    "freeWeight": true,
    "notes": "Fallback if you are not strong enough for chins/pull-ups AND have no access to a lat pulldown or machine pulldown (p. 249).",
    "fixes": []
  },
  {
    "id": "barbell-row",
    "name": "Barbell Row",
    "short": "Barbell Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "middle delts",
      "erectors"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": true,
    "notes": "Classified as an upper free-weight compound, 3-12 reps @ RPE 6-9 (p. 209) and as a strength compound accessory, 4-8 reps @ RPE 6-9 (p. 210). Used in the sample strength routine (p. 89). Loads the lumbar, so prefer supported rows in powerlifting routines (p. 249). Helms' personal cue for lat emphasis: pull toward the waist, use straps or a thumbless grip to reduce biceps takeover (p. 156, individual not general advice).",
    "fixes": []
  },
  {
    "id": "cable-row",
    "name": "Cable Row",
    "short": "Cable Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "middle delts"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": false,
    "notes": "Explicitly advised horizontal-row option because it does NOT fatigue the lumbar — critical in powerlifting routines so deadlift performance isn't compromised (pp. 248-249). Upper machine compound: 6-15 reps @ RPE 6-10 (p. 209).",
    "fixes": []
  },
  {
    "id": "chest-supported-row",
    "name": "Chest-Supported Dumbbell Row",
    "short": "Chest-Supported Dumbbell Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "middle delts"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": true,
    "notes": "Advised horizontal-row option that spares the lumbar (p. 249).",
    "fixes": []
  },
  {
    "id": "chin-up",
    "name": "Chin Up",
    "short": "Chin Up",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "vertical_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "biceps"
    ],
    "secondary": [
      "rear delts",
      "triceps (shoulder extension)"
    ],
    "slots": [
      "verticalPull"
    ],
    "freeWeight": true,
    "notes": "Free choice for vertical pulling, but you must be able to perform it at the assigned RPE and rep range (p. 249). Named as the free-weight/bodyweight option when low reps and heavy loads are assigned — 'chins (with weight as needed)' (p. 249). Full-ROM close-grip vertical pulling takes the elbow through full flexion, so it gives a more complete biceps stimulus than a row (p. 83). Canonical APS partner for the overhead press (p. 180).",
    "fixes": []
  },
  {
    "id": "lat-pulldown",
    "name": "Lat Pulldown",
    "short": "Lat Pulldown",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "vertical_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "biceps"
    ],
    "secondary": [
      "rear delts",
      "chest (shoulder extension)",
      "triceps (shoulder extension)"
    ],
    "slots": [
      "verticalPull"
    ],
    "freeWeight": false,
    "notes": "Use if you can't do chins at the target RPE/reps (p. 249). Expert instruction measurably improves lat activation in novices — form matters (p. 156). Upper machine compound: 6-15 reps @ RPE 6-10 (p. 209). A relatively safe place to train to failure (p. 67). Not merely a 'back and biceps' movement — the pecs and triceps assist shoulder extension (p. 83).",
    "fixes": []
  },
  {
    "id": "machine-pulldown",
    "name": "Machine Pulldown",
    "short": "Machine Pulldown",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "vertical_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "biceps"
    ],
    "secondary": [
      "rear delts"
    ],
    "slots": [
      "verticalPull"
    ],
    "freeWeight": false,
    "notes": "Interchangeable with the lat pulldown as the scalable vertical-pull option (p. 249).",
    "fixes": []
  },
  {
    "id": "machine-row",
    "name": "Machine Row",
    "short": "Machine Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "middle delts"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": false,
    "notes": "Advised lumbar-sparing row (p. 249). One of the machine compounds where training to failure is comparatively safe (p. 67). Appears in the strength rep table as 'HS row', 8-15 reps @ RPE 7-10 (p. 210).",
    "fixes": []
  },
  {
    "id": "pendlay-row",
    "name": "Pendlay Row (elevated)",
    "short": "Pendlay Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "erectors"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": true,
    "notes": "Named as the solid free-weight option when low reps and heavy loads are assigned for a horizontal pull — 'an elevated Pendlay row or bench row (AKA seal row)' (p. 249). Higher lumbar cost than the supported options.",
    "fixes": []
  },
  {
    "id": "pull-up",
    "name": "Pull Up",
    "short": "Pull Up",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "vertical_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "biceps"
    ],
    "secondary": [
      "rear delts"
    ],
    "slots": [
      "verticalPull"
    ],
    "freeWeight": true,
    "notes": "Same rules as chins: acceptable only if you can hit the target RPE and rep range (p. 249).",
    "fixes": []
  },
  {
    "id": "seal-row-bench-row",
    "name": "Seal Row / Bench Row (Bench Pull)",
    "short": "Seal Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "middle delts"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": true,
    "notes": "Advised lumbar-sparing row (p. 249) and named as the free-weight option when heavy low-rep horizontal pulling is programmed (p. 249). The canonical APS partner for the bench press — one study found increased volume load with bench-press/bench-pull pairing (p. 178). Caveat: because the long head of the triceps assists shoulder extension, lifters who get triceps fatigue from pulling should avoid this pairing (p. 178). Do NOT insert it into squat rest intervals (p. 179).",
    "fixes": []
  },
  {
    "id": "single-arm-dumbbell-row",
    "name": "Single-Arm Dumbbell Row",
    "short": "Single-Arm Dumbbell Row",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "horizontal_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "scapular retractors"
    ],
    "secondary": [
      "rear delts",
      "biceps",
      "middle delts"
    ],
    "slots": [
      "horizontalPull",
      "horizontalPull2"
    ],
    "freeWeight": true,
    "notes": "Advised horizontal-row option that spares the lumbar (p. 249).",
    "fixes": []
  },
  {
    "id": "weighted-chin-up",
    "name": "Weighted Chin Up / Pull Up",
    "short": "Weighted Chin-Up",
    "category": "Vertical and Horizontal Pulls",
    "pattern": "vertical_pull",
    "type": "accessory",
    "muscles": [
      "lats",
      "biceps"
    ],
    "secondary": [
      "rear delts"
    ],
    "slots": [
      "verticalPull"
    ],
    "freeWeight": true,
    "notes": "Use when you are too strong for bodyweight to fall in the assigned RPE/rep range (p. 249); the preferred option when heavy low-rep vertical pulling is programmed.",
    "fixes": []
  },
  {
    "id": "decline-press",
    "name": "Decline Press (barbell / dumbbell / machine)",
    "short": "Decline Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "horizontal_push",
    "type": "accessory",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [],
    "freeWeight": false,
    "notes": "Allowed for horizontal pressing without a very severe angle (p. 249). Designated substitute for dips when injury precludes them — barbell or dumbbell preferably (p. 252).",
    "fixes": []
  },
  {
    "id": "dumbbell-bench-chest-press",
    "name": "Dumbbell Bench / Chest Press",
    "short": "Dumbbell Bench / Chest Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "horizontal_push",
    "type": "accessory",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [],
    "freeWeight": true,
    "notes": "Injury fallback when a barbell can't be used; sum the dumbbell loads for a rough 1RM estimate or use RPE (p. 249). Named as a way to accumulate pressing volume when the competition bench causes elbow/shoulder pain (p. 158). Appears as 'Flat DB Press' and 'Incline DB Press' in the sample hypertrophy routine (p. 92).",
    "fixes": [
      "bench:elbow_and_shoulder_pain_limits_bench_volume"
    ]
  },
  {
    "id": "dumbbell-overhead-press",
    "name": "Dumbbell Overhead Press",
    "short": "Dumbbell Overhead Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "vertical_push",
    "type": "accessory",
    "muscles": [
      "anterior delts",
      "triceps"
    ],
    "secondary": [
      "middle delts"
    ],
    "slots": [
      "verticalPush"
    ],
    "freeWeight": true,
    "notes": "Use if an injury prevents barbell pressing; dumbbell loads can be summed to estimate 1RM (with the stated limitations) or simply use RPE (p. 249).",
    "fixes": []
  },
  {
    "id": "incline-press",
    "name": "Incline Press (barbell / dumbbell / machine)",
    "short": "Incline Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "horizontal_push",
    "type": "accessory",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps",
      "middle delts"
    ],
    "slots": [],
    "freeWeight": false,
    "notes": "Allowed for horizontal pressing but 'don't use a very severe angle' (p. 249). Specified as 'Inc Push' on Day 4 of the novice bodybuilding program — dumbbell, barbell, or machine as desired (p. 249). Incline adds middle-delt involvement (p. 84); the clavicular head of the pec has different attachments than the sternal head, which is the legitimate anatomical basis for angle variety (p. 152). APS partner for the seal row in the worked example (p. 180).",
    "fixes": []
  },
  {
    "id": "machine-chest-press",
    "name": "Machine Chest Press",
    "short": "Machine Chest Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "horizontal_push",
    "type": "accessory",
    "muscles": [
      "chest",
      "anterior delts"
    ],
    "secondary": [
      "triceps"
    ],
    "slots": [],
    "freeWeight": false,
    "notes": "Injury-driven fallback for barbell horizontal pressing (p. 249); machines were used to replace much of the upper-body free-weight work for an injured show-winning athlete (p. 42).",
    "fixes": []
  },
  {
    "id": "machine-overhead-press",
    "name": "Machine Overhead Press",
    "short": "Machine Overhead Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "vertical_push",
    "type": "accessory",
    "muscles": [
      "anterior delts",
      "triceps"
    ],
    "secondary": [
      "middle delts"
    ],
    "slots": [
      "verticalPush"
    ],
    "freeWeight": false,
    "notes": "Injury-driven fallback for barbell vertical pressing (p. 249).",
    "fixes": []
  },
  {
    "id": "overhead-press",
    "name": "Overhead Press / Military Press (barbell, standing)",
    "short": "Overhead Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "vertical_push",
    "type": "accessory",
    "muscles": [
      "anterior delts",
      "triceps"
    ],
    "secondary": [
      "middle delts"
    ],
    "slots": [
      "verticalPush"
    ],
    "freeWeight": true,
    "notes": "Standing or seated are both fine — your choice (p. 249). Barbell preferred when using %1RM progression (smaller increments, micro-loading, accurate AMRAP-based 1RM estimation) (p. 249). Named as a way to accumulate pressing volume when the competition bench causes elbow/shoulder pain (p. 158). Middle delts are notably involved in vertical pushing (p. 85). Full-ROM vertical pushing takes the elbow through more complete extension, giving more triceps stimulus (p. 83). Upper free-weight compound: 3-12 reps @ RPE 6-9 (p. 209); strength compound accessory 4-8 @ RPE 6-9 (p. 210). APS partner: chins (p. 180). Do NOT superset with front raises — not antagonists (p. 177).",
    "fixes": [
      "bench:elbow_and_shoulder_pain_limits_bench_volume"
    ]
  },
  {
    "id": "seated-overhead-press",
    "name": "Seated Overhead Press",
    "short": "Seated Overhead Press",
    "category": "Vertical and Horizontal Pushes",
    "pattern": "vertical_push",
    "type": "accessory",
    "muscles": [
      "anterior delts",
      "triceps"
    ],
    "secondary": [
      "middle delts"
    ],
    "slots": [
      "verticalPush"
    ],
    "freeWeight": true,
    "notes": "'For vertical pressing, feel free to do either standing or seated presses' (p. 249).",
    "fixes": []
  }
];

export const BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

export function byId(id) { return BY_ID[id] || null; }
export function nameOf(id) { return BY_ID[id]?.short || BY_ID[id]?.name || id; }

/**
 * Options for a slot, most appropriate first.
 *
 * Ordering matters: for a squat-variation slot the book's primary set is the
 * barbell free-weight squats, with leg press variants allowed only as an
 * injury fallback. Presenting them alphabetically would bury the right answers.
 */
const TYPE_RANK = { main: 0, variation: 1, accessory: 2, isolation: 3 };

export function optionsForSlot(slotType, { preferFreeWeight = false } = {}) {
  return EXERCISES
    .filter((e) => e.slots.includes(slotType))
    .sort((a, b) => {
      if (preferFreeWeight && a.freeWeight !== b.freeWeight) return Number(b.freeWeight) - Number(a.freeWeight);
      const t = (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
      if (t) return t;
      if (a.freeWeight !== b.freeWeight) return Number(b.freeWeight) - Number(a.freeWeight);
      return a.short.localeCompare(b.short);
    });
}

/** Sensible starting pick for each slot — the book's own default advice. */
export const SLOT_DEFAULTS = {
  squat: 'back-squat-low-bar',
  bench: 'bench-press',
  deadlift: 'deadlift',
  squatVariant: 'front-squat',
  benchVariant: 'close-grip-bench-press',
  deadliftVariant: 'romanian-deadlift',
  hipHingeVariant: 'weighted-back-extension',
  verticalPull: 'weighted-chin-up',
  verticalPush: 'overhead-press',
  horizontalPull: 'pendlay-row',
  horizontalPull2: 'chest-supported-row',
  legCurl: 'leg-curl',
  triceps: 'triceps-extension',
  weightedAb: 'weighted-ab-exercise',
  facePull: 'face-pull',
  grip: 'rack-partial-hold',
  legPress: 'leg-press',
  singleLeg: 'bulgarian-split-squat',
  calf: 'standing-calf-raise',
  biceps: 'bicep-curl',
};

/** Human labels + the book's selection rule for each choosable slot. */
export const SLOT_INFO = {
  squat:           { label: 'Competition squat',   rule: 'Your competition squat. Train it regardless of whether it suits your leverages — it is the lift you are judged on.' },
  bench:           { label: 'Competition bench',   rule: 'Your competition bench press.' },
  deadlift:        { label: 'Competition deadlift', rule: 'Your competition deadlift — conventional or sumo, whichever you compete with.' },
  squatVariant:    { label: 'Squat variation',     rule: 'Any barbell free-weight squat. If you squat low-bar, pick something that lets you stay upright to give your hips a break — front, high-bar or safety-bar. If a technical fault shows up at maximal loads, pick the variation that punishes it. If injury rules out barbell squatting, a leg press variant is allowed.' },
  benchVariant:    { label: 'Bench variation',     rule: 'An alteration of your competition bench: closer or wider grip, boards, flat back, feet up, a longer pause, or accommodating resistance. If you bench wide, close-grip is the default recommendation. Close grip means closer than your competition grip — no narrower than push-up width with elbows tucked.' },
  deadliftVariant: { label: 'Deadlift variation',  rule: 'Conventional, sumo, RDL, good morning, or a modified-ROM pull. For 6+ reps use an RDL or good morning so the eccentric stays controlled.' },
  hipHingeVariant: { label: 'Hip hinge',           rule: 'Trains the posterior chain with less upper-body support and less lumbar and hip fatigue than a deadlift variant.' },
  verticalPull:    { label: 'Vertical pull',       rule: 'Pulldown or chin/pull-up. You must be able to hit the prescribed reps at the prescribed RPE — add weight if you are too strong for it, use band assistance or a pulldown if not strong enough yet.' },
  verticalPush:    { label: 'Vertical push',       rule: 'Overhead press, standing or seated. Prefer a barbell when load is driven off %1RM — smaller jumps and better max estimates.' },
  horizontalPull:  { label: 'Row (heavier)',       rule: 'The book advises a free-weight option for the heavier rowing session. Critically, pick one that does not fatigue your lower back — that would compromise your deadlift.' },
  horizontalPull2: { label: 'Row (higher reps)',   rule: 'Second row of the week, higher reps. Again, nothing that taxes the lumbar.' },
  legCurl:         { label: 'Leg curl',            rule: 'The short head of the hamstring only crosses the knee, so squats and deadlifts alone can leave it underdeveloped.' },
  triceps:         { label: 'Triceps',             rule: 'Any pain-free full-ROM triceps movement.' },
  weightedAb:      { label: 'Weighted ab work',    rule: 'Loaded, not endless bodyweight reps.' },
  facePull:        { label: 'Face pull',           rule: 'Upper-back and external rotation work.' },
  grip:            { label: 'Grip work',           rule: 'The specific need is holding a very heavy bar statically. Crushing grippers transfer poorly. 3 sets of 10-20 s holds at 90-110% of your max, or single-arm bodyweight hangs.' },
  legPress:        { label: 'Leg press',           rule: 'Quad-biased, low lumbar cost. The fallback if barbell squatting is not available.' },
  singleLeg:       { label: 'Single-leg squat',    rule: 'Prefer free-weight, bodyweight or band-assisted so you keep the coordination and balance benefit.' },
  calf:            { label: 'Calf raise',          rule: 'Standing versions must be straight-legged.' },
  biceps:          { label: 'Biceps',              rule: 'Any pain-free full-ROM curl.' },
};
