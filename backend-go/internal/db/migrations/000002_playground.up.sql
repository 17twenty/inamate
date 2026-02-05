-- Create system user for owning system resources
INSERT INTO users (id, email, password, display_name)
VALUES (
    'usr_system',
    'system@inamate.local',
    '', -- No password - cannot login
    'System'
) ON CONFLICT (id) DO NOTHING;

-- Create the playground project with a well-known ID
INSERT INTO projects (id, name, owner_id, fps, width, height)
VALUES (
    'proj_playground',
    'Playground',
    'usr_system',
    24,
    1280,
    720
) ON CONFLICT (id) DO NOTHING;

-- Create initial snapshot with demo objects
INSERT INTO project_snapshots (id, project_id, version, document)
VALUES (
    'snap_playground_v1',
    'proj_playground',
    1,
    '{
        "project": {
            "id": "proj_playground",
            "name": "Playground",
            "version": 1,
            "fps": 24,
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z",
            "scenes": ["scene_main"],
            "assets": [],
            "rootTimeline": "tl_main"
        },
        "scenes": {
            "scene_main": {
                "id": "scene_main",
                "name": "Scene 1",
                "width": 1280,
                "height": 720,
                "background": "#1a1a2e",
                "root": "obj_root"
            }
        },
        "objects": {
            "obj_root": {
                "id": "obj_root",
                "type": "Group",
                "parent": null,
                "children": ["obj_rect", "obj_ellipse", "obj_triangle", "obj_spinner"],
                "transform": {"x": 0, "y": 0, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "", "stroke": "", "strokeWidth": 0, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {}
            },
            "obj_rect": {
                "id": "obj_rect",
                "type": "ShapeRect",
                "parent": "obj_root",
                "children": [],
                "transform": {"x": 200, "y": 200, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "#e94560", "stroke": "#000000", "strokeWidth": 2, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {"width": 200, "height": 150}
            },
            "obj_ellipse": {
                "id": "obj_ellipse",
                "type": "ShapeEllipse",
                "parent": "obj_root",
                "children": [],
                "transform": {"x": 640, "y": 360, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "#0f3460", "stroke": "#16213e", "strokeWidth": 2, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {"rx": 120, "ry": 80}
            },
            "obj_triangle": {
                "id": "obj_triangle",
                "type": "VectorPath",
                "parent": "obj_root",
                "children": [],
                "transform": {"x": 900, "y": 200, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "#53d769", "stroke": "#2d6a4f", "strokeWidth": 2, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {"commands": [["M", 0, 150], ["L", 100, 0], ["L", 200, 150], ["Z"]]}
            },
            "obj_spinner": {
                "id": "obj_spinner",
                "type": "Symbol",
                "parent": "obj_root",
                "children": ["obj_spinner_rect", "obj_spinner_ellipse"],
                "transform": {"x": 500, "y": 450, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "", "stroke": "", "strokeWidth": 0, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {"timelineId": "tl_spinner"}
            },
            "obj_spinner_rect": {
                "id": "obj_spinner_rect",
                "type": "ShapeRect",
                "parent": "obj_spinner",
                "children": [],
                "transform": {"x": -30, "y": -50, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "#f5a623", "stroke": "#c78400", "strokeWidth": 2, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {"width": 60, "height": 100}
            },
            "obj_spinner_ellipse": {
                "id": "obj_spinner_ellipse",
                "type": "ShapeEllipse",
                "parent": "obj_spinner",
                "children": [],
                "transform": {"x": 0, "y": -70, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0},
                "style": {"fill": "#bd10e0", "stroke": "#8b0ba8", "strokeWidth": 2, "opacity": 1},
                "visible": true,
                "locked": false,
                "data": {"rx": 20, "ry": 20}
            }
        },
        "timelines": {
            "tl_main": {
                "id": "tl_main",
                "length": 48,
                "tracks": []
            },
            "tl_spinner": {
                "id": "tl_spinner",
                "length": 24,
                "tracks": ["track_spinner_rotation"]
            }
        },
        "tracks": {
            "track_spinner_rotation": {
                "id": "track_spinner_rotation",
                "objectId": "obj_spinner",
                "property": "transform.r",
                "keys": ["kf_spin_0", "kf_spin_end"]
            }
        },
        "keyframes": {
            "kf_spin_0": {
                "id": "kf_spin_0",
                "frame": 0,
                "value": 0,
                "easing": "linear"
            },
            "kf_spin_end": {
                "id": "kf_spin_end",
                "frame": 23,
                "value": 360,
                "easing": "linear"
            }
        },
        "assets": {}
    }'::jsonb
) ON CONFLICT (id) DO NOTHING;
