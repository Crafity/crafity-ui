/*jslint browser: true, nomen: true, vars: true, white: true */
/*globals Window*/

(function (crafity) {
	"use strict";

	(function (html) {

		function Element(type) {
			if (!this || this instanceof Window) {
				return new Element(type);
			}
			this._type = type;
		}

		Element.prototype = crafity.core.EventEmitter.prototype;
		Element.prototype.getChildren = function () {
			if (!this._children) {
				this._children = [];
			}
			return this._children;
		};
		Element.prototype.setChildren = function (children) {
			if (this._children) {
				this._children = children;
			}
			return this._children;
		};
		Element.prototype.clear = function () {
			var self = this;
			var children = self.getChildren();
			if (!children.length) {
				return self;
			}
			children.forEach(function (child) {
				self.getElement().removeChild(child.getElement());
			});
			self.setChildren([]);
			return this;
		};
		Element.prototype.render = function () {
			return this.getElement();
		};
		Element.prototype.getType = function () {
			return this._type;
		};
		Element.prototype.getElement = function () {
			if (!this._element) {
				this._element = document.createElement(this.getType());
			}
			return this._element;
		};
		Element.prototype.prepend = function (children) {
			if (!children) {
				return this;
			}
			var self = this;

			function addChild(child) {
				if (child instanceof Element) {
					self.setChildren([child].concat(self.getChildren()));
					if (self.getElement().childNodes.length > 0) {
						self.getElement().insertBefore(child.render(), self.getElement().childNodes[0]);
					} else {
						self.getElement().appendChild(child.render());
					}
				} else {
					throw new Error("Unexpected child to append");
				}
			}

			if (children instanceof Array) {
				children.forEach(function (child) {
					addChild(child);
				});
			} else if (children instanceof Element) {
				addChild(children);
			} else {
				throw new Error("Unexpected child to append");
			}

			return this;
		};
		Element.prototype.append = function (children) {
			if (!children) {
				return this;
			}
			var self = this;

			function addChild(child) {
				if (child instanceof Element) {
					self.getChildren().push(child);
					self.getElement().appendChild(child.render());
				} else {
					throw new Error("Unexpected child to append");
				}
			}

			if (children instanceof Array) {
				children.forEach(addChild);
			} else if (children instanceof Element) {
				addChild(children);
			} else {
				throw new Error("Unexpected child to append");
			}

			return this;
		};
		Element.prototype.appendTo = function (parent) {
			if (!parent) {
				return this;
			}
			parent.append(this);
			return this;
		};
		Element.prototype.addClass = function (classNames) {
			var classString = this.getElement().getAttribute("class");
			var classes = (classString && classString.length && classString.split(" ")) || [];
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				if (classes.indexOf(classToAdd) > -1) {
					return;
				}
				classes.push(classToAdd);
			});
			this.getElement().setAttribute("class", classes.join(" "));
			return this;
		};
		Element.prototype.attr = function (name, value) {
			if (value === undefined) {
				return this.getElement().getAttribute(name);
			}
			if (value === null) {
				this.getElement().removeAttribute(name);
			} else {
				this.getElement().setAttribute(name, value);
			}
			return this;
		};
		Element.prototype.hasClass = function (classNames) {
			var classes = (this.getElement().getAttribute("class") || "").split(" ");
			var classesToCheck = classNames.split(" ");
			if (classesToCheck.length === 0) {
				return false;
			}
			var hasClasses = true;
			classesToCheck.forEach(function (classToAdd) {
				var index = classes.indexOf(classToAdd);
				hasClasses = hasClasses && (index > -1);
			});
			return hasClasses;
		};
		Element.prototype.hasNotClass = function (classNames) {
			return !this.hasClass(classNames);
		};
		Element.prototype.removeClass = function (classNames) {
			var classString = this.getElement().getAttribute("class");
			var classes = (classString && classString.length && classString.split(" ")) || [];
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				var index = classes.indexOf(classToAdd);
				if (index === -1) {
					return;
				}
				classes.splice(index, 1);
			});
			this.getElement().setAttribute("class", classes.join(" "));
			return this;
		};
		Element.prototype.toggleClass = function (classNames) {
			var self = this;
			//var classes = (this.getElement().getAttribute("class") || "").split(" ");
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				if (self.hasClass(classToAdd)) {
					self.removeClass(classToAdd);
				} else {
					self.addClass(classToAdd);
				}
			});
			return this;
		};
		Element.prototype.isVisible = function () {
			return this.hasClass("visible") || !this.hasClass("hidden");
		};
		Element.prototype.readonly = function (value) {
			if (value === true) {
				this.attr("readonly", "readonly");
				this.emit("readonlyChanged", value);
			} else if (value === false) {
				this.attr("readonly", null);
				this.emit("readonlyChanged", value);
			} else {
				return !!this.attr("readonly");
			}
			return this;
		};
		Element.prototype.disabled = function (value) {
			if (value === true) {
				this.attr("disabled", "disabled");
				this.emit("disabledChanged", value);
			} else if (value === false) {
				this.attr("disabled", null);
				this.emit("disabledChanged", value);
			} else {
				return !!this.attr("disabled");
			}
			return this;
		};
		Element.prototype.tabindex = function (value) {
			if (value) {
				this.attr("tabindex", value);
			} else if (value === null) {
				this.attr("tabindex", null);
			} else {
				return !!this.attr("tabindex");
			}
			return this;
		};
		Element.prototype.show = function () {
			this.removeClass("hidden");
			return this;
		};
		Element.prototype.hide = function () {
			this.addClass("hidden");
			return this;
		};
		Element.prototype.text = function (text) {
			if (text) {
				this.getElement().textContent = text;
				return this;
			}
			return this.getElement().textContent;
		};
		Element.prototype.value = function (value) {
			if (value !== undefined) {
				this.getElement().value = value;
				return this;
			}
			return this.getElement().value;
		};
		Element.prototype.change = function (callback) {
			var self = this;
			if (callback === undefined) {
				throw new Error("Argument 'callback' is required");
			} else if (callback === null && this.addEventListener.change) {
				self.addEventListener.change.forEach(function (cb) {
					self.removeEventListener("change", cb);
				});
				self.addEventListener.change = [];
			} else if (typeof callback === 'function') {
				self.addEventListener("change", function	() {
					callback(self.value());
				});
				if (!self.addEventListener.change) {
					self.addEventListener.change = [];
				}
				self.addEventListener.change.push(callback);
			}
			return self;
		};
		Element.prototype.focus = function (callback) {
			var self = this;
			if (callback === undefined) {
				self.getElement().focus();
			} else if (callback === null && this.addEventListener.focus) {
				self.addEventListener.focus.forEach(function (cb) {
					self.removeEventListener("focus", cb);
				});
				self.addEventListener.focus = [];
			} else if (typeof callback === 'function') {
				self.addEventListener("focus", callback);
				if (!self.addEventListener.focus) {
					self.addEventListener.focus = [];
				}
				self.addEventListener.focus.push(callback);
			}
			return self;
		};
		Element.prototype.blur = function (callback) {
			var self = this;
			if (callback === undefined) {
				throw new Error("Argument 'callback' is required");
			} else if (callback === null && this.addEventListener.blur) {
				self.addEventListener.blur.forEach(function (cb) {
					self.removeEventListener("blur", cb);
				});
				self.addEventListener.blur = [];
			} else if (typeof callback === 'function') {
				self.addEventListener("blur", callback);
				if (!self.addEventListener.blur) {
					self.addEventListener.blur = [];
				}
				self.addEventListener.blur.push(callback);
			}
			return self;
		};

		Element.prototype.id = function (id) {
			if (id) {
				this.getElement().setAttribute("id", id);
				return this;
			}
			return this.getAttribute("id");
		};
		Element.prototype.toggleVisibility = function () {
			if (this.isVisible()) {
				this.hide();
			} else {
				this.show();
			}
		};
		Element.prototype.addEventListener = function () {
			this.getElement().addEventListener.apply(this.getElement(), arguments);
			return this;
		};
		Element.prototype.removeEventListener = function () {
			this.getElement().removeEventListener.apply(this.getElement(), arguments);
			return this;
		};
		html.Element = Element;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
