-- Seed the course catalogue from the courses that used to be hardcoded in
-- src/pages/SetupWizard.jsx. Re-runnable: existing rows are updated in place.
-- These are global/public courses, so created_by stays null.

insert into public.courses (id, name, location, holes, bg, pars, stroke_index, tees, is_public, created_by)
values
  (
    'pinehurst', 'Pinehurst No.2', 'Pinehurst, NC', 18, '/courses/course.png',
    null, null, null, true, null
  ),
  (
    'harbor', 'Harbor Dunes', 'Pawleys Island, SC', 18, '/courses/sunset.png',
    null, null, null, true, null
  ),
  (
    'lincoln', 'Lincoln Park', 'San Francisco, CA', 18, '/courses/turf.png',
    null, null, null, true, null
  ),
  (
    'tetherow', 'Tetherow', 'Bend, OR', 18, '/courses/tetherow.jpg',
    '{"1":4,"2":5,"3":3,"4":4,"5":4,"6":4,"7":3,"8":4,"9":5,"10":4,"11":4,"12":4,"13":5,"14":3,"15":4,"16":4,"17":3,"18":5}'::jsonb,
    '{"1":11,"2":17,"3":15,"4":1,"5":9,"6":7,"7":13,"8":3,"9":5,"10":18,"11":6,"12":10,"13":8,"14":12,"15":2,"16":4,"17":14,"18":16}'::jsonb,
    '[
      {"name":"Kidd","color":"#6d28d9","yards":7283,"rating":75.2,"slope":150,"par":72},
      {"name":"Black","color":"#111827","yards":6933,"rating":73.7,"slope":145,"par":72},
      {"name":"Tan","color":"#c2a878","yards":6485,"rating":71.4,"slope":139,"par":72},
      {"name":"Sage","color":"#8a9a5b","yards":5960,"rating":69.2,"slope":133,"par":72}
    ]'::jsonb,
    true, null
  ),
  (
    'losttracks', 'Lost Tracks Golf Course', 'Bend, OR', 18, '/courses/losttracks.webp',
    '{"1":4,"2":4,"3":4,"4":4,"5":3,"6":4,"7":5,"8":3,"9":5,"10":4,"11":3,"12":5,"13":4,"14":4,"15":4,"16":3,"17":4,"18":5}'::jsonb,
    '{"1":11,"2":17,"3":3,"4":9,"5":15,"6":7,"7":1,"8":13,"9":5,"10":8,"11":16,"12":10,"13":4,"14":6,"15":14,"16":18,"17":2,"18":12}'::jsonb,
    '[
      {"name":"Championship","color":"#111827","yards":7003,"rating":73.1,"slope":135,"par":72},
      {"name":"Tournament","color":"#1d4ed8","yards":6401,"rating":70.4,"slope":126,"par":72},
      {"name":"Middle","color":"#15803d","yards":6073,"rating":68.5,"slope":124,"par":72},
      {"name":"Forward","color":"#dc2626","yards":5344,"rating":70.0,"slope":129,"par":73}
    ]'::jsonb,
    true, null
  )
on conflict (id) do update set
  name         = excluded.name,
  location     = excluded.location,
  holes        = excluded.holes,
  bg           = excluded.bg,
  pars         = excluded.pars,
  stroke_index = excluded.stroke_index,
  tees         = excluded.tees,
  is_public    = excluded.is_public;
