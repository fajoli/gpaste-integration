const St = imports.gi.St;
const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Tweener = imports.ui.tweener;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GPaste = imports.gi.GPaste;
const Panel = imports.ui.panel;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const GPasteItemsCounter = Me.imports.gpaste_items_counter;
const GPasteItemsView = Me.imports.gpaste_items_view;
const GPasteItem = Me.imports.gpaste_item;
const GPasteButtons = Me.imports.gpaste_buttons;
const StatusBar = Me.imports.status_bar;
const PrefsKeys = Me.imports.prefs_keys;

const ANIMATION_TIME = 0.5;

const GPasteIntegration = new Lang.Class({
    Name: "GPasteIntegration",

    _init: function() {
        this._client = new GPaste.Client();
        this._client.connect('changed', Lang.bind(this, function() {
            this._items_view.set_display_mode(
                GPasteItemsView.ViewMode.TEXT
            );
            this._update_history();

            if(this.is_open) this._items_view.show_all();
        }));
        this._client.connect('show-history', Lang.bind(this, this.toggle));

        this.actor = new St.BoxLayout({
            reactive: true,
            track_hover:true,
            can_focus: true
        });
        this.actor.connect(
            'key-press-event',
            Lang.bind(this, this._on_key_press_event)
        );
        this.actor.connect(
            'key-release-event',
            Lang.bind(this, this._on_key_release_event)
        );
        Main.layoutManager.panelBox.add_actor(this.actor);
        this.actor.lower_bottom();

        this._table = new St.Table({
            style_class: 'gpaste-box',
            homogeneous: false
        });
        this.actor.add_actor(this._table);

        this._statusbar = new StatusBar.StatusBar();
        this._init_search_entry();
        this._items_view = new GPasteItemsView.GPasteItemsView(this._statusbar);
        this._items_view.connect(
            "item-clicked",
            Lang.bind(this, this._on_item_clicked)
        );
        this._items_counter = new GPasteItemsCounter.GPasteItemsCounter(
            this._items_view
        );
        this._buttons = new GPasteButtons.GPasteButtons(this);

        this._table.add(this._search_entry, {
            row: 0,
            col: 0,
            col_span: 3,
            x_fill: true,
            x_expand: true,
            y_fill: false,
            y_expand: false,
            y_align: St.Align.START,
            x_align: St.Align.START
        });
        this._table.add(this._items_view.actor, {
            row: 1,
            col: 0,
            col_span: 3,
            x_fill: true,
            y_fill: true,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });
        this._table.add(this._buttons.actor, {
            row: 2,
            col: 2,
            x_fill: false,
            x_expand: false,
            y_fill: false,
            y_expand: false,
            y_align: St.Align.MIDDLE,
            x_align: St.Align.END
        });
        this._table.add(this._items_counter.actor, {
            row: 2,
            col: 0,
            x_fill: false,
            x_expand: false,
            y_fill: false,
            y_expand: false,
            y_align: St.Align.MIDDLE,
            x_align: St.Align.START
        });
        this._table.add(this._statusbar.actor, {
            row: 2,
            col: 1,
            x_fill: false,
            x_expand: false,
            y_fill: false,
            y_expand: false,
            y_align: St.Align.MIDDLE,
            x_align: St.Align.END
        });

        this._open = false;
        this._delete_queue = [];
        this._resize();
        this._update_history();
    },

    _on_item_clicked: function(object, button, item) {
        switch(button) {
            case Clutter.BUTTON_SECONDARY:
                this.delete_item(item);
                break;
            case Clutter.BUTTON_MIDDLE:
                break;
            default:
                this.activate_item(item);
                break;
        }
    },

    _init_search_entry: function() {
        this._search_entry = new St.Entry({
            style_class: "gpaste-search-entry",
            hint_text: "Type to search",
            track_hover: true,
            can_focus: true
        });
        this._search_entry.connect('key-press-event',
            Lang.bind(this, this._on_search_key_press_event)
        );
        this._search_entry.clutter_text.connect('text-changed',
            Lang.bind(this, this._on_search_text_changed)
        );
        this._inactive_icon = new St.Icon({
            style_class: 'gpaste-search-entry-icon',
            icon_name: 'edit-find-symbolic',
            reactive: false
        });
        this._active_icon = new St.Icon({
            style_class: 'gpaste-search-entry-icon',
            icon_name: 'edit-clear-symbolic',
            reactive: true
        });
        this._search_entry.set_secondary_icon(this._inactive_icon);
        this._search_entry.connect('secondary-icon-clicked',
            Lang.bind(this, function() {
                this._search_entry.set_text('');
            })
        );
    },

    _update_history: function() {
        let history = this._client.get_history();

        if(history === null) {
            this._items_view.show_message(
                "Couldn't connect to GPaste daemon"
            );
            this.history = [];
        }
        else if(history.length < 1) {
            this._items_view.show_message("Empty");
            this.history = [];
        }
        else {
            this.history = history;
        }
    },

    _on_key_press_event: function(o, e) {
        let symbol = e.get_key_symbol()
        let ch = Utils.get_unichar(symbol);
        let selected_count = this._items_view.get_selected().length;

        if(symbol === Clutter.Escape) {
            this.hide();
            return true;
        }
        else if(symbol === Clutter.Up) {
            if(selected_count > 0) {
                this._items_view.select_previous();
            }
            else {
                this._items_view.select_first();
            }

            return true;
        }
        else if(symbol === Clutter.Down) {
            if(selected_count > 0) {
                this._items_view.select_next();
            }
            else {
                this._items_view.select_first();
            }

            return true;
        }
        else if(ch) {
            this._search_entry.set_text(ch);
            this._search_entry.grab_key_focus();
            return true;
        }
        else {
            return false;
        }
    },

    _on_key_release_event: function(o, e) {
        let symbol = e.get_key_symbol()

        if(symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
            let selected = this._items_view.get_selected();

            if(selected.length === 1) {
                this.activate_item(selected[0]);
            }

            return true;
        }
        else if(symbol == Clutter.Delete) {
            let selected = this._items_view.get_selected();

            if(selected.length === 1) {
                this.delete_item(selected[0]);
            }

            return true;
        }
        else {
            return false;
        }
    },

    _is_empty_entry: function(entry) {
        if(Utils.is_blank(entry.text) || entry.text === entry.hint_text) {
            return true
        }
        else {
            return false;
        }
    },

    _on_search_key_press_event: function(o, e) {
        let symbol = e.get_key_symbol();
        let ctrl = (e.get_state() & Clutter.ModifierType.CONTROL_MASK)

        if(symbol === Clutter.Escape) {
            if(ctrl) {
                this.hide();
            }
            else {
                this._search_entry.set_text('');
                this.actor.grab_key_focus();
            }

            return true;
        }

        return false;
    },

    _on_search_text_changed: function() {
        if(!this._is_empty_entry(this._search_entry)) {
            this._search_entry.set_secondary_icon(this._active_icon);
            this._items_view.filter(this._search_entry.text);
        }
        else {
            if(this._search_entry.text === this._search_entry.hint_text) return;

            this.actor.grab_key_focus();
            this._search_entry.set_secondary_icon(this._inactive_icon);
            this._items_view.set_display_mode(GPasteItemsView.ViewMode.TEXT);
            this._items_view.show_all();
        }
    },

    _resize: function() {
        let message_id = this._statusbar.add_message(
            'Test1234!',
            0,
            StatusBar.MESSAGE_TYPES.info,
            true
        );
        let width_percents = Utils.SETTINGS.get_int(
            PrefsKeys.WIDTH_PERCENTS_KEY
        );
        let height_percents = Utils.SETTINGS.get_int(
            PrefsKeys.HEIGHT_PERCENTS_KEY
        );
        let primary = Main.layoutManager.primaryMonitor;
        let available_height = primary.height - Main.panel.actor.height;
        let my_width = primary.width / 100 * width_percents;
        let my_height = available_height / 100 * height_percents;

        this.actor.x = primary.width - my_width;
        this._hidden_y = this.actor.get_parent().height - my_height;
        this._target_y = this._hidden_y + my_height;

        this.actor.y = this._hidden_y;
        this.actor.width = my_width;
        this.actor.height = my_height;

        this._table.width = my_width;
        this._table.height = my_height;
        this._statusbar.remove_message(message_id);
    },

    activate_item: function(item) {
        this._client.select(item.id);
        this._search_entry.set_text('')
        this.hide(false);
    },

    delete_item: function(item) {
        this._delete_queue.push(item.id);
        this._items_view.remove_item(item);
    },

    show: function(animation, target) {
        if(this._open) return;

        animation = animation === undefined ? true : animation;
        let push_result = Main.pushModal(this.actor, {
            keybindingMode: Shell.KeyBindingMode.NORMAL
        });

        if(!push_result) return;

        this._open = true;
        this.actor.show();
        this._resize();
        this._items_view.show_all();
        target = target === undefined ? this._target_y : target;

        if(animation) {
            Tweener.removeTweens(this.actor);
            Tweener.addTween(this.actor, {
                time: ANIMATION_TIME / St.get_slow_down_factor(),
                transition: 'easeOutQuad',
                y: target
            });
        }
        else {
            this.actor.y = target;
        }

        if(!this._is_empty_entry(this._search_entry)) {
            this._search_entry.clutter_text.set_selection(
                0,
                this._search_entry.text.length
            );
            this._items_view.filter(this._search_entry.text);
            this._search_entry.grab_key_focus();
        }

        this._items_view.actor.vscroll.adjustment.value = 0;
    },

    hide: function(animation, target) {
        if(!this._open) return;

        Main.popModal(this.actor);
        this._open = false;
        this._items_view.unselect_all();
        animation = animation === undefined ? true : animation;

        if(animation) {
            Tweener.removeTweens(this.actor);
            Tweener.addTween(this.actor, {
                time: ANIMATION_TIME / St.get_slow_down_factor(),
                transition: 'easeOutQuad',
                y: this._hidden_y,
                onComplete: Lang.bind(this, function() {
                    this.actor.hide();
                })
            });
        }
        else {
            this.actor.hide();
            this.actor.y = this._hidden_y;
        }

        if(this._delete_queue.length > 0) {
            Mainloop.idle_add(Lang.bind(this, function() {
                for(let i = 0; i < this._delete_queue.length; i++) {
                    this._client.delete(this._delete_queue[i]);
                }

                this._delete_queue = [];
            }));
        }
    },

    toggle: function() {
        if(this._open) {
            this.hide();
        }
        else {
            this.show();
        }
    },

    destroy: function() {
        this.actor.destroy();
    },

    get is_open() {
        return this._open;
    },

    get history() {
        return this._history;
    },

    set history(arr) {
        this._history = [];
        let items = [];

        for(let i = 0; i < arr.length; i++) {
            let item_data = {
                id: i,
                text: arr[i],
                markup: false
            };
            items.push(new GPasteItem.GPasteItem(item_data));
            this._history.push(item_data);
        }

        this._items_view.clear();
        this._items_view.set_items(items);
    },

    get client() {
        return this._client;
    }
});
