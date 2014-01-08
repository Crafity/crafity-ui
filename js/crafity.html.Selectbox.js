/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {
		var EMPTY_SELECT_VALUE = " ";
		
		function Selectbox() {
			var self = this;

			this._selectedValue = new html.Element("span").text(EMPTY_SELECT_VALUE);
			this.append(this._selectedValue);

			this._optionList = new Selectbox.OptionList();
			this.append(this._optionList);

			this._mouseInfo = this._optionList._mouseInfo;

			this._options = [];
			this.addClass("selectbox edit collapsed");
			this.tabindex("0");

			this._optionList
				.on("selected", function (value) {
					if (self.value() !== value) {
						self.value(value);
						self.emit("selected", value);
					}
					self.focus();
				})
				.blur(function () {
					self._mouseInfo.source = null;
					self._mouseInfo.isdown = false;
					self._mouseInfo.islong = false;

					if (self.readonly()) { return false; }
					return self.removeClass("expanded").addClass("collapsed");
				});

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly").tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly").tabindex(null);
				}
				self._optionList.readonly(bool);
			});
			var showOptionListTimer;
			this.value = function (value) {
				if (value === undefined) {
					return self._optionList.value();
				}
				self._optionList.value(value);
				self._selectedValue.text(self._optionList.getFriendlyName() || EMPTY_SELECT_VALUE);
				return self;
			};

			function showOptionList(e) {
				clearTimeout(showOptionListTimer);
				showOptionListTimer = setTimeout(function () {
					if (self._mouseInfo.isdown) { self._mouseInfo.islong = true; }
				}, 400);

				self.addClass("expanded").removeClass("collapsed");
				self._optionList.show();

				// Now see if the top and the bottom of the options list fits on the screen
				var optionListElement = self._optionList.getElement();
				var rects = optionListElement.getClientRects();
				if (rects.length) {
					var top = rects[0].top;
					var bottom = rects[0].top + rects[0].height;
					var marginTop = optionListElement.style.marginTop.replace(/px$/i, "");
					if (top < 0) {
						optionListElement.style.marginTop = (parseInt(marginTop, 10) - top) + "px";
					}
					if (bottom > window.innerHeight) {
						optionListElement.style.marginTop = parseInt(marginTop, 10) - (bottom - window.innerHeight) + "px";
					}
				}
				e.preventDefault();
				return false;
			}

			function highlightSelectedItem(optionList) {
				function onmousemove() {
					optionList
						.removeEventListener("mousemove", onmousemove)
						.removeClass("nohover");
				}

				optionList
					.addClass("nohover")
					.removeEventListener("mousemove", onmousemove)
					.addEventListener("mousemove", onmousemove);
			}

			this.addEventListener("keyup", function (e) {
				if (self.readonly()) { return; }
				if ((e.keyCode === 13 || e.keyCode === 32) && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.target === self.getElement() || e.target === undefined)) {
					if (self._optionList.hasNotClass("visible")) {
						highlightSelectedItem(self._optionList);
						showOptionList(e);
					}
				}
			});
			this.addEventListener("mousedown", function (e) {
				if (self._mouseInfo.source !== null && self._mouseInfo.source !== self) { return true; }
				if (self.readonly()) { return; }
				self._mouseInfo.source = self;
				self._mouseInfo.isdown = true;
				self._mouseInfo.islong = false;
				return showOptionList(e);
			});
		}

		Selectbox.OptionList = function OptionList() {
			var self = this;
			this._elements = [];
			this._mouseInfo = {
				isdown: false,
				islong: false,
				source: null
			};
			this.addClass("option-list collapsed").tabindex("0");
			this.selectedItem = null;
			this.highlightedItem = null;
			this.addEventListener("blur", function () {
				if (self.readonly()) { return false; }
				if (self._mouseInfo.isdown) { return false; }
				self.removeClass("expanded").addClass("collapsed").removeClass("visible");
				self.emit("lostFocus");
			});
			this.value = function (value) {
				if (value === undefined) {
					return self._selectedValue;
				}
				self._selectedValue = value;
				self.selectedItem = null;
				self.highlightedItem = null;
				self.getChildren().forEach(function (optionElement, index) {
					if (optionElement.attr("data-value") === (value || "").toString()) {
						self.selectedItem = optionElement;
						self.highlightedItem = optionElement;
						optionElement.addClass("selected");
						self.getElement().style.marginTop = -1 * (16 + 2) * index + "px";
					} else {
						optionElement.removeClass("selected");
					}
				});

				return self;
			};
		};
		Selectbox.OptionList.prototype = new html.Element("div");
		Selectbox.OptionList.prototype.options = function (options) {
			var self = this;
			var previousElement = null;
			self._elements = [];

			if (options === undefined) {
				return self._options;
			}
			self._options = options;
			self.selectedItem = null;
			self.highlightedItem = null;

			self.addEventListener("keyup", function (e) {
				if (self.readonly()) { return; }
				var currentItem = (self.highlightedItem || self.selectedItem) || (self.getChildren().length && self.getChildren()[0]);
				if (e.keyCode === 38 && !e.shiftKey && !e.ctrlKey && !e.metaKey) { // Up
					if (self.hasClass("visible")) {
						var previousOption = currentItem && currentItem.previousOption;
						self.removeClass("nohover");
						if (previousOption) {
							previousOption.addClass("hover");
							if (currentItem) { currentItem.removeClass("hover"); }
							self.highlightedItem = previousOption;
						}
						e.preventDefault();
						return false;
					}
				}
				if (e.keyCode === 40 && !e.shiftKey && !e.ctrlKey && !e.metaKey) { // Down
					if (self.hasClass("visible")) {
						var nextOption = currentItem && currentItem.nextOption;
						self.removeClass("nohover");
						self._elements.forEach(function (el) {
							el.removeClass("hover");
						});
						if (nextOption) {
							nextOption.addClass("hover");
							if (currentItem) { currentItem.removeClass("hover"); }
							self.highlightedItem = nextOption;
						}
						e.preventDefault();
						return false;
					}
				}
				if ((e.keyCode === 13 || e.keyCode === 32) && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.target === self.getElement() || e.target === undefined)) {
					self.hide().emit("selected", currentItem.attr("data-value"));
					e.preventDefault();
					return false;
				}
			});

			Object.keys(options).forEach(function (key, index) {
				var element = new html.Element("div")
					.addClass("option")
					.attr("data-value", key)
					.text(options[key]);
				self._elements.push(element);
				if (previousElement) {
					previousElement.nextOption = element;
					element.previousOption = previousElement;
				}
				element.nextOption = null;
				previousElement = element;

				self.append(element);
				element.addEventListener("mouseover", function () {
					self.removeClass("nohover");
					element.addClass("hover");
					if (self.highlightedItem) { self.highlightedItem.removeClass("hover"); }
					self.highlightedItem = element;
				});
				element.addEventListener("mouseout", function () {
					element.removeClass("hover");
				});
				element.addEventListener("mousedown", function (e) {
					self._mouseInfo.source = self;
					self._mouseInfo.isdown = true;
					self._mouseInfo.islong = false;
					self.focus();
					e.preventDefault();
					return false;
				});
				element.addEventListener("mouseup", function () {
					if (self._mouseInfo.islong || self._mouseInfo.source === self) {
						self.hide().emit("selected", key);
					}
					self._mouseInfo.source = null;
					self._mouseInfo.isdown = false;
					self._mouseInfo.islong = false;
				});
				if (self._selectedValue === options[key]) {
					self.selectedItem = element;
					self.highlightedItem = element;
					element.addClass("selected").addClass("hover");
					self.getElement().style.marginTop = -1 * (16 + 2) * index + "px";
				}
			});
			return self;
		};
		Selectbox.OptionList.prototype.getFriendlyName = function () {
			return this._options[this.value()];
		};
		Selectbox.OptionList.prototype.show = function () {
			this.removeClass("collapsed").addClass("visible expanded").focus();
			if (this.selectedItem) { this.selectedItem.addClass("hover"); }
			return this;
		};
		Selectbox.OptionList.prototype.hide = function () {
			this.removeClass("visible expanded").addClass("collapsed").focus();
			return this;
		};

		Selectbox.prototype = new html.Element("div");
		Selectbox.prototype.options = function (options) {
			var self = this;
			if (options === undefined) {
				return self._optionList.options();
			}
			self._optionList.options(options);
			return self;

		};
		html.Selectbox = Selectbox;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
