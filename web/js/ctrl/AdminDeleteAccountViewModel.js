"use strict";

tutao.provide('tutao.tutanota.ctrl.AdminDeleteAccountViewModel');

/**
 * Handles deleting the customer account. This view model is created dynamically.
 * @constructor
 */
tutao.tutanota.ctrl.AdminDeleteAccountViewModel = function() {
	tutao.util.FunctionUtils.bindPrototypeMethodsToThis(this);

    this.reason = ko.observable("");
    this.takeoverMailAddress = ko.observable("");
    this.takeoverMailAddress.subscribe(this._checkTakeoverMailAddress);
    this.takeoverMailAddressStatus = ko.observable({ type: "valid", text: "emptyString_msg" });

	this.password = ko.observable("");
    this.password.subscribe(this._checkPassword);
	this.passwordStatus = ko.observable({ type: "neutral", text: "passwordEnterNeutral_msg" });

    this.deleteAccountStatus = ko.observable({ type: "neutral", text: "deleteAccountInfo_msg" });
    this.busy = ko.observable(false);

    // unsubscribe premium
    this.state = new tutao.tutanota.util.SubmitStateMachine();

    this.customer = null;
    // if we access the user in the user controller directly (without setTimeout), a new AdminDeleteAccountViewModel is created as soon as the user controller fires the update event on the user
    // to avoid that, we have to do all user dependent calls in a setTimeout.
    var self = this;

    this.state.setInputInvalidMessageListener(this._stateInputInvalidListener);

    setTimeout(function() {
        tutao.locator.userController.getLoggedInUser().loadCustomer().then(function (customer) {
            self.customer = customer;
            self.state.entering(true);
        });
    });
};


/**
 * Called when the confirm button is clicked by the user. Triggers the next state in the state machine.
 */
tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype.unsubscribePremium = function() {
    if (!this.state.submitEnabled()) {
        return;
    }
    var self = this;
    tutao.tutanota.gui.confirm(tutao.lang("unsubscribePremiumConfirm_msg")).then(function(confirmed) {
        if (confirmed) {
            self.state.submitting(true);
            var service = new tutao.entity.sys.SwitchAccountTypeData();
            service.setAccountType(tutao.entity.tutanota.TutanotaConstants.ACCOUNT_TYPE_FREE);
            service.setDate(tutao.entity.tutanota.TutanotaConstants.CURRENT_DATE);

            self.customer.registerObserver(self._customerUpdated);
            service.setup({}, null).then(function () {
                self.state.success(true);
                // we wait for _customerUpdated to switch to the account view
                self._switchPremiumToFreeGroup();
            }).caught(tutao.InvalidDataError, function (exception) {
                self.state.setFailureMessage("accountSwitchTooManyActiveUsers_msg");
                self.state.failure(true);
            }).caught(tutao.PreconditionFailedError, function (exception) {
                self.state.setFailureMessage("accountSwitchAdditionalPackagesActive_msg");
                self.state.failure(true);
            }).caught(function (error) {
                self.state.failure(true);
            });
        }
    });
};

tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype._switchPremiumToFreeGroup = function() {
    return tutao.entity.sys.SystemKeysReturn.load({}, null).then(function(keyData) {
        return new tutao.entity.sys.MembershipAddData()
            .setUser(tutao.locator.userController.getLoggedInUser().getId())
            .setGroup(keyData.getFreeGroup())
            .setSymEncGKey(tutao.locator.aesCrypter.encryptKey(tutao.locator.userController.getUserGroupKey(), tutao.util.EncodingConverter.base64ToKey(keyData.getFreeGroupKey())))
            .setup({}, null)
            .then(function() {
                return new tutao.entity.sys.MembershipRemoveData()
                    .setUser(tutao.locator.userController.getLoggedInUser().getId())
                    .setGroup(keyData.getPremiumGroup())
                    .erase({}, null);
            });
    }).caught(function(e) {
        console.log("error switching premium to free group", e);
    });
};

tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype._customerUpdated = function() {
    this.customer.unregisterObserver(this._customerUpdated);
    tutao.locator.settingsViewModel.show(tutao.tutanota.ctrl.SettingsViewModel.DISPLAY_ADMIN_INVOICING);
};

tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype._stateInputInvalidListener = function() {
    var currentMailAddress = tutao.locator.userController.getUserGroupInfo().getMailAddress();
    if ( !tutao.tutanota.util.Formatter.isTutanotaMailAddress(currentMailAddress) ){
        return "deactivatePremiumWithCustomDomainError_msg";
    }
    if ( this.customer != null && this.customer.getType() == tutao.entity.tutanota.TutanotaConstants.ACCOUNT_TYPE_PREMIUM && this.customer.getCanceledPremiumAccount()) {
        return "premiumAccountCanceled_msg";
    }
    return null;
};

/**
 * Checks the entered old password and updates the password status.
 */
tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype._checkPassword = function() {
    var self = this;
    if (this.password().trim() == "") {
        this.passwordStatus({ type: "neutral", text: "passwordEnterNeutral_msg" });
    } else {
        this.passwordStatus({ type: "neutral", text: "check_msg" });
        tutao.locator.kdfCrypter.generateKeyFromPassphrase(self.password(), tutao.locator.userController.getSalt(), tutao.entity.tutanota.TutanotaConstants.KEY_LENGTH_TYPE_128_BIT).then(function(key) {
            var v = tutao.util.EncodingConverter.base64ToBase64Url(tutao.crypto.Utils.createAuthVerifier(key));
            if(v == tutao.locator.userController.getAuthVerifier()) {
                self.passwordStatus({ type: "valid", text: "passwordValid_msg" });
            } else {
                self.passwordStatus({ type: "invalid", text: "passwordWrongInvalid_msg" });
            }
        });
    }
};

/**
 * Checks if the entered takeover mail address is a valid mail address.
 */
tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype._checkTakeoverMailAddress = function() {
    if (this.takeoverMailAddress().trim() == "") {
        this.takeoverMailAddressStatus({ type: "valid", text: "emptyString_msg" });
    } else if (tutao.tutanota.util.Formatter.getCleanedMailAddress(this.takeoverMailAddress())) {
        this.takeoverMailAddressStatus({ type: "valid", text: "validInputFormat_msg" });
    } else {
        this.takeoverMailAddressStatus({ type: "invalid", text: "mailAddressInvalid_msg" });
    }
};

/**
 * Provides the information if the user may press the confirm button.
 * @return {boolean} True if the button can be presse, false otherwise.
 */
tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype.confirmPossible = function() {
	return  !this.busy() && this.passwordStatus().type == "valid" && this.takeoverMailAddressStatus().type == "valid";
};

/**
 * Called when the confirm button is clicked by the user. Triggers the next state in the state machine.
 */
tutao.tutanota.ctrl.AdminDeleteAccountViewModel.prototype.confirm = function() {
	if (!this.confirmPossible()) {
        return;
    }
    var self = this;
    var takeover = (self.takeoverMailAddress().trim() != "");
    var confirmMessage = (takeover) ? tutao.lang("deleteAccountWithTakeoverConfirm_msg", { "{1}": self.takeoverMailAddress() }) : tutao.lang("deleteAccountConfirm_msg");
    tutao.tutanota.gui.confirm(confirmMessage).then(function(confirmed) {
        if (confirmed) {
            self.busy(true);
            self.deleteAccountStatus({ type: "neutral", text: "deleteAccountWait_msg" });
            var customerService = new tutao.entity.sys.DeleteCustomerData();
            customerService.setUndelete(false);
            customerService.setCustomer(tutao.locator.userController.getLoggedInUser().getCustomer());
            customerService.setReason(self.reason());
            if (takeover) {
                customerService.setTakeoverMailAddress(tutao.tutanota.util.Formatter.getCleanedMailAddress(self.takeoverMailAddress()));
            } else {
                customerService.setTakeoverMailAddress(null);
            }
            tutao.locator.eventBus.notifyNewDataReceived = function() {}; // avoid NotAuthenticatedError
            return customerService.erase({}, null).then(function() {
                self.password("");
                return tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("deleteAccountDeleted_msg")).then(function() {
                    tutao.locator.navigator.logout();
                });
            }).caught(tutao.InvalidDataError, function(e) {
                self.deleteAccountStatus({ type: "invalid", text: "takeoverAccountInvalid_msg" });
                self.busy(false);
            });
        }
    });
};
