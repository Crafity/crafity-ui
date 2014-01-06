/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function MenuPanel(name, init) {
			this._menuItems = new html.Element("ul");
			this.addClass("menu-panel hidden");
			if (name) {
				this.append(new html.Element("h2").text(name));
			}
			this.append(this._menuItems);

			if (init) {
				init(this.getElement());
			}
		}

		MenuPanel.prototype = new html.Element("div");
		MenuPanel.prototype.addMenuItem = function (menuItem) {
			var self = this;
			this._menuItems.append(menuItem);
			menuItem.on("click", function (clickedMenuItem) {
				self._menuItems.getChildren().forEach(function (mi) {
					if (mi !== clickedMenuItem) {
						mi.removeClass("selected");
					}
				});
				clickedMenuItem.addClass("selected");
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

			self.on("click", callback);

			var anchor = new html.Element("a");
			anchor.attr("href", "#" + name);
			anchor.addEventListener("click", function () {
				self.emit("click", self);
			});
			this.on("selected", function () {
				self.emit("click", self);
			});
			anchor.text(name);
			this.addClass("menuitem");

			this.append(anchor);
		}

		MenuItem.prototype = new html.Element("li");
		MenuItem.prototype.select = function () {
			this.addClass("selected");
			this.emit("selectionChanged", this);
			this.emit("selected", this);
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
		
