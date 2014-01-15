/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Menu() {
			this.addClass("main menu");
		}

		Menu.prototype = new crafity.html.Element("div");
		Menu.prototype.addMenuPanel = function (menuPanel) {
			var self = this;
			this.append(menuPanel);
			menuPanel.on("selected", function (name, menuPanel, menuItem) {
				self.children().forEach(function (mp) {
					if (mp !== menuPanel) {
						mp.deselectAll();
					}
				});
				self.emit("selected " + name, menuPanel, menuItem);
				self.emit("selected", name, menuPanel, menuItem);
			});
			return self;
		};
		Menu.prototype.addMenuPanels = function (menuPanels) {
			var self = this;
			if (menuPanels instanceof Array) {
				menuPanels.forEach(function (menuPanel) {
					self.addMenuPanel(menuPanel);
				});
			}
			if (menuPanels instanceof html.Element) {
				self.addMenuPanel(menuPanel);
			}
			return self;
		};

		html.Menu = Menu;

		function MenuPanel(name) {
			this.name = name;
			this._menuItems = new html.Element("ul");
			this.addClass("menu-panel hidden");
			if (name) {
				this.append(new html.Element("h2").text(name));
			}
			this.append(this._menuItems);
		}

		MenuPanel.prototype = new html.Element("div");
		MenuPanel.prototype.deselectAll = function () {
			this._menuItems.children().forEach(function (mi) {
				mi.removeClass("selected");
			});
		};
		MenuPanel.prototype.addMenuItem = function (menuItem) {
			var self = this;
			this._menuItems.append(menuItem);
			menuItem.on("click", function () {
				self._menuItems.children().forEach(function (mi) {
					if (mi !== menuItem) {
						mi.removeClass("selected");
					}
				});
				menuItem.addClass("selected");
				self.emit("selected " + self.name + " " + menuItem.name, self, menuItem);
				self.emit("selected", self.name + " " + menuItem.name, self, menuItem);
			});
			return self;
		};
		MenuPanel.prototype.addMenuItems = function (menuItems) {
			var self = this;
			if (menuItems instanceof Array) {
				menuItems.forEach(function (menuItem) {
					self.addMenuItem(menuItem);
				});
			}
			if (menuItems instanceof html.Element) {
				self.addMenuItem(menuItems);
			}
			return self;
		};
		html.MenuPanel = MenuPanel;

		function MenuItem(name, callback) {
			var self = this;

			callback && self.on("click", callback);

			var anchor = new html.Element("a");
			anchor.attr("href", "#" + name);
			anchor.addEventListener("click", function (e) {
				if (!self.disabled()) { 
					self.emit("click");
				}
				e.preventDefault();
				return false; 
			});
			this.on("selected", function () {
				self.emit("click", self);
			});
			anchor.text(name);
			this.addClass("menuitem");
			this.name = name;
			this.append(anchor);
		}

		MenuItem.prototype = new html.Element("li");
		MenuItem.prototype.select = function () {
			var self = this;
			self.addClass("selected");
			setTimeout(function () {
				self.emit("selectionChanged", self);
				self.emit("selected", self);
				self.emit("click", self);
			}, 0);
			return this;
		};
		MenuItem.prototype.selected = function () {
			return this.hasClass("selected");
		};
		MenuItem.prototype.deselect = function () {
			this.removeClass("selected");
			this.emit("selectionChanged", this);
			this.emit("deselected", this);
			return this;
		};
		html.MenuItem = MenuItem;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
