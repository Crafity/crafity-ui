/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function List() {
			var self = this;

			this._searchBox = new html.Searchbox();
			this.onsearch = function (filter) {
				if (!filter) {
					return;
				}
				self._searchBox.on("change", filter);
			};
			this._listitems = [];
			this.addClass("list");
			this._itemContainer = new html.Element("ul").addClass("itemContainer");

			this.append(this._searchBox);
			this.append(this._itemContainer);
		}

		List.prototype = new html.Element("div");
		List.prototype.focus = function () {
			this._searchBox.focus();
		};
		List.prototype.addListItem = function (listItem) {
			var self = this;

			listItem.on("click", function updateSelection() {
				self.getListItems().forEach(function (listitem) {
					if (listitem !== listItem) {
						listitem.deselect();
					}
				});
				listItem.select();
			});

			this._listitems.push(listItem);
			this._itemContainer.append(listItem);
		};
		List.prototype.addListItems = function (listItems) {
			var self = this;
			listItems.forEach(function (listItem) {
				self.addListItem(listItem);
			});
		};
		List.prototype.clearListItems = function () {
			this._itemContainer.clear();
			this._listitems = [];
		};
		List.prototype.getListItems = function () {
			return [].concat(this._listitems);
		};
		html.List = List;

		function ListItem(name, data) {
			var self = this;

			if (name !== undefined) {
				this.addClass("listitem");
				this.append(new html.Element("div").addClass("content").text(name));
			}
			if (data !== undefined) { this._data = data; }
			this.tabindex("0");
			this.addEventListener("click", function () {
				self.emit("click", self);
			});
			this.addEventListener("focus", function () {
				self.emit("click", self);
			});
		}

		ListItem.prototype = new html.Element("li");
		ListItem.prototype.select = function () {
			this.addClass("selected");
			this.emit("selectionChanged", this);
			this.emit("selected", this);
			return this;
		};
		ListItem.prototype.selected = function () {
			return this.hasClass("selected");
		};
		ListItem.prototype.deselect = function () {
			this.removeClass("selected");
			this.emit("selectionChanged", this);
			this.emit("deselected", this);
			return this;
		};
		html.ListItem = ListItem;

		function MultiLineListItem(title, date, content, data) {
			var self = this;
			this.addClass("multiline listitem");
			this.append(new html.Element("div").addClass("title").text(title));
			this.append(new html.Element("div").addClass("date").text(date));
			this.append(new html.Element("div").addClass("content").text(content));
			this._data = data;
			this.tabindex("0");
			this.addEventListener("click", function () {
				self.emit("click", self);
			});
			this.addEventListener("focus", function () {
				self.emit("click", self);
			});
			
		}

		MultiLineListItem.prototype = Object.create(ListItem.prototype);
		MultiLineListItem.prototype.constructor = MultiLineListItem;

		html.MultiLineListItem = MultiLineListItem;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
