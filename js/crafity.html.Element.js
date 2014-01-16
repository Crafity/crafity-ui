/*jslint browser: true, nomen: true, vars: true, white: true */
/*globals Window*/

(function (crafity) {
	"use strict";

	(function (html) {

		function Element(type) {
			if (!type) {
				throw new Error("Argument 'type' is required");
			}
			if (!this || this instanceof Window) {
				return new Element(type);
			}
			if (typeof type === "string") {
				//this._element = null;
				this._type = type;
			} else {
				this._type = type.tagName;
				this._element = type;
			}
		}

		Element.prototype = crafity.core.EventEmitter.prototype;
		Element.prototype.children = function (children) {
			if (children === undefined) {
				return this._children = this._children || [];
			}
			if (this._children) {
				this._children = children;
			}
			return this;
		};
		Element.prototype.clear = function () {
			var self = this;
			var children = this.children();
			if (!children.length) {
				return self;
			}
			children.forEach(function (child) {
				self.element().removeChild(child.element());
			});
			this.children([]);
			return this;
		};
		Element.prototype.render = function () {
			return this.element();
		};
		Element.prototype.getType = function () {
			return this._type;
		};
		Element.prototype.data = function (data) {
			if (data === undefined) {
				return this._data;
			}
			this._data = data;
			this.emit("dataChanged", data);
			return this;
		};		
		Element.prototype.element = function () {
			if (!this._element) {
				this._element = document.createElement(this.getType());
				//this._element.self = this;
			} 
//			else if (this._element.self !== this) {
//				var _element = this._element; //.cloneNode();
//				delete this._element;
//				this._element = _element;
//				this._element.self = this;
//				console.log("Cloning", this._element.self, this);
//			}
			return this._element;
		};
		Element.prototype.prepend = function (children) {
			if (!children) {
				return this;
			}
			var self = this;

			function addChild(child) {
				if (child instanceof Element) {
					self.children([child].concat(self.children()));
					if (self.element().childNodes.length > 0) {
						self.element().insertBefore(child.render(), self.element().childNodes[0]);
					} else {
						self.element().appendChild(child.render());
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
				throw new Error("Argument 'children' is required");
			}
			var self = this;

			function addChild(child) {
				if (child instanceof Element) {
					self.children().push(child);
					self.element().appendChild(child.render());
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
				throw new Error("Argument 'parent' is required");
			}
			parent.append(this);
			return this;
		};
		Element.prototype.addClass = function (classNames) {
			var classString = this.element().getAttribute("class");
			var classes = (classString && classString.length && classString.split(" ")) || [];
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				if (classes.indexOf(classToAdd) > -1) {
					return;
				}
				classes.push(classToAdd);
			});
			this.element().setAttribute("class", classes.join(" "));
			return this;
		};
		Element.prototype.attr = function (name, value) {
			if (value === undefined) {
				return this.element().getAttribute(name);
			}
			if (value === null) {
				this.element().removeAttribute(name);
			} else {
				this.element().setAttribute(name, value);
			}
			return this;
		};
		Element.prototype.hasClass = function (classNames) {
			var classes = (this.element().getAttribute("class") || "").split(" ");
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
			var classString = this.element().getAttribute("class");
			var classes = (classString && classString.length && classString.split(" ")) || [];
			var classesToAdd = classNames.split(" ");
			classesToAdd.forEach(function (classToAdd) {
				var index = classes.indexOf(classToAdd);
				if (index === -1) {
					return;
				}
				classes.splice(index, 1);
			});
			this.element().setAttribute("class", classes.join(" "));
			return this;
		};
		Element.prototype.toggleClass = function (classNames) {
			var self = this;
			//var classes = (this.element().getAttribute("class") || "").split(" ");
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
				this.addClass("readonly");
				this.attr("readonly", "readonly");
				this.emit("readonlyChanged", value);
			} else if (value === false) {
				this.removeClass("readonly");
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
				this.element().textContent = text;
				return this;
			}
			return this.element().textContent;
		};
		Element.prototype.html = function (html) {
			if (html) {
				this.element().innerHTML = html;
				return this;
			}
			return this.element().innerHTML;
		};
		Element.prototype.value = function (value) {
			if (value !== undefined) {
				this.element().value = value;
				return this;
			}
			return this.element().value;
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
				self.addEventListener("change", function () {
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
				self.element().focus();
				if (self.addEventListener.focus) {
					self.addEventListener.focus.forEach(function (cb) {
						cb.call(self);
					});
				}
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
				this.element().setAttribute("id", id);
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
			this.element().addEventListener.apply(this.element(), arguments);
			return this;
		};
		Element.prototype.removeEventListener = function () {
			this.element().removeEventListener.apply(this.element(), arguments);
			return this;
		};
		html.Element = Element;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
